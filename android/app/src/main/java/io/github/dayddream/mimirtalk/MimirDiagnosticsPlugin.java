package io.github.dayddream.mimirtalk;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.webkit.WebSettings;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 原生诊断插件：把版本号、时间、异常类型、堆栈、页面视图、WebView 版本写入本地报告文件，
 * 供前端在“导出诊断”时经 SAF 打包取回（不做系统分享）。
 *
 * 报告只落在应用私有目录 {@code getFilesDir()/diagnostics/}，不采集聊天正文、图片内容与
 * 用户输入；目录上限 20 份，单份截断至 256KB 以内，避免拖垮弱机型存储与内存。
 *
 * 同时提供 {@link #writeRawReport} 静态入口，供 {@link MimirTalkApplication} 的崩溃兜底与
 * {@link MainActivity} 的 WebView 渲染进程终止回调复用同一套“写文件 + 上限清理”逻辑，
 * 崩溃路径不做二次抛出。
 */
@CapacitorPlugin(name = "MimirDiagnostics")
public class MimirDiagnosticsPlugin extends Plugin {

    /** 诊断报告目录名，位于 getFilesDir() 之下。 */
    private static final String DIAGNOSTICS_DIR_NAME = "diagnostics";

    /** 单份报告上限 256KB。 */
    private static final long MAX_REPORT_BYTES = 256L * 1024L;

    /** 目录内报告份数上限。 */
    private static final int MAX_REPORT_COUNT = 20;

    /** Bug 文件夹授权与已转存记录。 */
    private static final String PREFS_NAME = "mimirtalk_diagnostics";
    private static final String KEY_BUG_FOLDER_URI = "bug_folder_uri";
    private static final String KEY_BUG_FOLDER_LABEL = "bug_folder_label";
    private static final String KEY_SYNCED_IDS = "bug_delivery_ids";

    private static final String BUG_FILE_PREFIX = "mimirtalk-bug-";
    private static final String REPORT_FILE_PREFIX = "report-";

    /** 时间戳格式，用于文件名与 ISO8601 字段。 */
    private static final String FILE_TIME_PATTERN = "yyyyMMdd-HHmmss-SSS";
    private static final String ISO_TIME_PATTERN = "yyyy-MM-dd'T'HH:mm:ss.SSSZ";

    private static final Random RANDOM = new Random();
    private static final Object SYNC_LOCK = new Object();
    private static final ExecutorService SYNC_EXECUTOR = Executors.newSingleThreadExecutor();

    /**
     * 列出现有诊断报告，按修改时间倒序。
     */
    @PluginMethod
    public void listReports(PluginCall call) {
        File dir = getDiagnosticsDir(getContext());
        File[] files = listReportFiles(dir);

        JSArray reports = new JSArray();
        for (File file : files) {
            JSObject item = new JSObject();
            item.put("id", file.getName());
            item.put("name", file.getName());
            item.put("at", toIsoTime(file.lastModified()));
            item.put("bytes", file.length());
            reports.put(item);
        }

        JSObject ret = new JSObject();
        ret.put("reports", reports);
        call.resolve(ret);
    }

    /**
     * 写入一条诊断报告，message 为空视为缺少异常信息。
     */
    @PluginMethod
    public void writeReport(PluginCall call) {
        String message = call.getString("message");
        if (message == null || message.isEmpty()) {
            call.reject("缺少异常信息");
            return;
        }

        String kind = call.getString("kind");
        String stack = call.getString("stack");
        String occurredAt = call.getString("occurred_at");
        String view = call.getString("view");

        try {
            File written = writeReportFile(getContext(), kind, message, stack, occurredAt, view);
            // 外部复制总在异步队列中执行，返回时仍待转存；无授权时同样保留到下次重试。
            boolean pendingSync = true;
            scheduleSync(getContext());
            JSObject ret = new JSObject();
            ret.put("written", true);
            ret.put("id", written.getName());
            ret.put("name", written.getName());
            ret.put("bytes", written.length());
            ret.put("pending_sync", pendingSync);
            call.resolve(ret);
        } catch (Exception error) {
            call.reject("写入诊断报告失败：" + error.getMessage(), error);
        }
    }

    /**
     * 选择或更换 Bug 记录文件夹。与长图导出文件夹使用独立授权和存储键。
     */
    @PluginMethod
    public void chooseBugFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        );
        startActivityForResult(call, intent, "chooseBugFolderResult");
    }

    @ActivityCallback
    private void chooseBugFolderResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("selected", false);
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        Uri folderUri = data.getData();
        int flags = data.getFlags()
            & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        if ((flags & Intent.FLAG_GRANT_READ_URI_PERMISSION) == 0
            || (flags & Intent.FLAG_GRANT_WRITE_URI_PERMISSION) == 0) {
            call.reject("无法保留 Bug 记录文件夹授权，请重新选择", "FOLDER_PERMISSION_REVOKED");
            return;
        }

        try {
            getContext().getContentResolver().takePersistableUriPermission(folderUri, flags);
        } catch (Exception error) {
            call.reject("无法保留 Bug 记录文件夹授权，请重新选择", "FOLDER_PERMISSION_REVOKED", error);
            return;
        }
        if (!hasPersistedReadWritePermission(getContext(), folderUri)) {
            call.reject("无法保留 Bug 记录文件夹授权，请重新选择", "FOLDER_PERMISSION_REVOKED");
            return;
        }

        String label = folderDisplayName(getContext(), folderUri);
        Uri previous = bugFolderUri(getContext());
        if (previous != null && !previous.equals(folderUri)) {
            releaseFolderPermission(getContext(), previous);
        }
        prefs(getContext()).edit()
            .putString(KEY_BUG_FOLDER_URI, folderUri.toString())
            .putString(KEY_BUG_FOLDER_LABEL, label)
            .apply();
        scheduleSync(getContext());

        JSObject ret = new JSObject();
        ret.put("selected", true);
        ret.put("folder_label", label);
        ret.put("folder_uri", folderUri.toString());
        call.resolve(ret);
    }

    /** 返回已保存的 Bug 文件夹名称；未设置时为空串。 */
    @PluginMethod
    public void bugFolderLabel(PluginCall call) {
        Uri folderUri = bugFolderUri(getContext());
        String label = prefs(getContext()).getString(KEY_BUG_FOLDER_LABEL, "");
        if ((label == null || label.isEmpty()) && folderUri != null) {
            label = folderDisplayName(getContext(), folderUri);
            prefs(getContext()).edit().putString(KEY_BUG_FOLDER_LABEL, label).apply();
        }
        JSObject ret = new JSObject();
        ret.put("label", label == null ? "" : label);
        ret.put("folder_uri", folderUri == null ? "" : folderUri.toString());
        call.resolve(ret);
    }

    /** 立即重试一次私有目录到 Bug 文件夹的转存。 */
    @PluginMethod
    public void retrySync(PluginCall call) {
        getBridge().execute(() -> {
            SyncResult result = syncReports(getContext());
            JSObject ret = new JSObject();
            ret.put("synced", result.synced);
            ret.put("pending", result.pending);
            ret.put("reason", result.reason);
            call.resolve(ret);
        });
    }

    /**
     * 清空诊断目录下的全部报告文件。
     */
    @PluginMethod
    public void clearReports(PluginCall call) {
        File dir = getDiagnosticsDir(getContext());
        File[] files = listReportFiles(dir);
        int count = 0;
        for (File file : files) {
            if (file.delete()) {
                count++;
            }
        }
        JSObject ret = new JSObject();
        ret.put("cleared", true);
        ret.put("count", count);
        call.resolve(ret);
    }

    /**
     * 经 SAF 把一份报告另存到用户选择的位置。
     */
    @PluginMethod
    public void exportReport(PluginCall call) {
        String id = call.getString("id");
        File source = reportFileFor(getContext(), id);
        if (source == null || !source.exists()) {
            call.reject("诊断报告不存在");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, source.getName());
        startActivityForResult(call, intent, "exportReportResult");
    }

    @ActivityCallback
    private void exportReportResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        final Uri target = data.getData();
        final String id = call.getString("id");
        getBridge().execute(() -> copyReportToUri(call, id, target));
    }

    private void copyReportToUri(PluginCall call, String id, Uri target) {
        File source = reportFileFor(getContext(), id);
        if (source == null || !source.exists()) {
            call.reject("诊断报告不存在");
            return;
        }
        try (InputStream in = new FileInputStream(source);
             OutputStream out = getContext().getContentResolver().openOutputStream(target)) {
            if (out == null) {
                call.reject("无法打开目标文件");
                return;
            }
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            out.flush();
            JSObject ret = new JSObject();
            ret.put("saved", true);
            ret.put("uri", target.toString());
            ret.put("file_name", source.getName());
            call.resolve(ret);
        } catch (Exception error) {
            call.reject("导出诊断报告失败：" + error.getMessage(), error);
        }
    }

    /**
     * 读取宿主应用的版本名与版本号。
     */
    @PluginMethod
    public void getAppVersion(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            PackageInfo info = packageInfo(getContext());
            ret.put("versionName", info.versionName == null ? JSONObject.NULL : info.versionName);
            ret.put("versionCode", versionCodeOf(info));
        } catch (Exception error) {
            ret.put("versionName", JSONObject.NULL);
            ret.put("versionCode", JSONObject.NULL);
        }
        call.resolve(ret);
    }

    /**
     * 崩溃兜底与渲染进程终止复用的静态写报告入口，异常一律吞掉，绝不二次抛出。
     *
     * @return 写入成功的报告文件；失败返回 null
     */
    public static File writeRawReport(Context context, String kind, String message, String stack, String occurredAt, String view) {
        try {
            File written = writeReportFile(context, kind, message, stack, occurredAt, view);
            scheduleSync(context);
            return written;
        } catch (Exception ignored) {
            return null;
        }
    }

    /** 应用启动、选择文件夹和写入报告后共用的异步转存入口。 */
    public static void scheduleSync(Context context) {
        if (context == null) {
            return;
        }
        final Context appContext = context.getApplicationContext();
        try {
            SYNC_EXECUTOR.execute(() -> syncReports(appContext));
        } catch (Throwable ignored) {
            // 执行器不可用时记录继续留在私有目录，下次启动再试。
        }
    }

    /**
     * 覆写以阻止 Capacitor 在 Activity 保存状态时序列化整个调用参数。
     *
     * @return 始终为 null，不写入任何实例状态
     */
    @Override
    protected Bundle saveInstanceState() {
        return null;
    }

    // ---------------------------------------------------------------------------------------------
    // 内部共用逻辑
    // ---------------------------------------------------------------------------------------------

    private static File getDiagnosticsDir(Context context) {
        return new File(context.getFilesDir(), DIAGNOSTICS_DIR_NAME);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private static Uri bugFolderUri(Context context) {
        String value = prefs(context).getString(KEY_BUG_FOLDER_URI, "");
        if (value == null || value.isEmpty()) {
            return null;
        }
        try {
            return Uri.parse(value);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static boolean isBugFolderReady(Context context) {
        return hasPersistedReadWritePermission(context, bugFolderUri(context));
    }

    private static boolean hasPersistedReadWritePermission(Context context, Uri folderUri) {
        if (folderUri == null || !DocumentsContract.isTreeUri(folderUri)) {
            return false;
        }
        for (android.content.UriPermission permission :
            context.getContentResolver().getPersistedUriPermissions()) {
            if (permission.getUri().equals(folderUri)
                && permission.isReadPermission()
                && permission.isWritePermission()) {
                return true;
            }
        }
        return false;
    }

    /**
     * ACTION_OPEN_DOCUMENT_TREE 返回的是 tree URI，查询和创建文档前需要先
     * 取出 tree documentId，再构造同一授权树下的文档 URI。
     */
    static Uri treeDocumentUri(Uri treeUri) {
        if (treeUri == null || !DocumentsContract.isTreeUri(treeUri)) {
            throw new IllegalArgumentException("not a document tree uri");
        }
        String treeDocumentId = DocumentsContract.getTreeDocumentId(treeUri);
        return DocumentsContract.buildDocumentUriUsingTree(treeUri, treeDocumentId);
    }

    private static void releaseFolderPermission(Context context, Uri folderUri) {
        if (folderUri == null || !DocumentsContract.isTreeUri(folderUri)) {
            return;
        }
        try {
            context.getContentResolver().releasePersistableUriPermission(
                folderUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            );
        } catch (Exception ignored) {
            // 系统已撤销授权时 release 会抛异常，目标已经达成。
        }
    }

    private static String folderDisplayName(Context context, Uri treeUri) {
        try (Cursor cursor = context.getContentResolver().query(
            treeDocumentUri(treeUri),
            new String[]{OpenableColumns.DISPLAY_NAME},
            null,
            null,
            null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (column >= 0) {
                    String value = cursor.getString(column);
                    if (value != null && !value.isEmpty()) {
                        return value;
                    }
                }
            }
        } catch (Exception ignored) {
            // 个别 provider 不返回 displayName，回退到 documentId。
        }
        try {
            String documentId = DocumentsContract.getTreeDocumentId(treeUri);
            int colon = documentId.indexOf(':');
            return colon >= 0 ? documentId.substring(colon + 1) : documentId;
        } catch (Exception ignored) {
            return "";
        }
    }

    /** 目录下所有 *.json 报告，按修改时间倒序；目录不存在时返回空数组。 */
    private static File[] listReportFiles(File dir) {
        File[] files = dir.isDirectory() ? dir.listFiles() : null;
        if (files == null || files.length == 0) {
            return new File[0];
        }
        List<File> reports = new ArrayList<>();
        for (File file : files) {
            if (file.isFile() && file.getName().endsWith(".json")) {
                reports.add(file);
            }
        }
        reports.sort((left, right) -> Long.compare(right.lastModified(), left.lastModified()));
        return reports.toArray(new File[0]);
    }

    /** 校验并解析报告文件名，拒绝带路径分隔符的非法 id。 */
    private static File reportFileFor(Context context, String id) {
        if (id == null || id.isEmpty() || id.contains("/") || id.contains("\\")) {
            return null;
        }
        return new File(getDiagnosticsDir(context), id);
    }

    /** 生成报告 JSON 字节，超上限时逐步截断 stack 字段。 */
    private static byte[] buildReportBytes(Context context, String kind, String message, String stack, String occurredAt, String view) {
        JSObject report = new JSObject();
        report.put("kind", safe(kind));
        report.put("message", safe(message));
        report.put("stack", "");
        report.put("occurred_at", safe(occurredAt));
        report.put("view", safe(view));
        report.put("app_version", appVersionName(context));
        report.put("app_version_code", appVersionCode(context));
        report.put("webview_version", webViewVersion(context));
        report.put("device_manufacturer", safe(Build.MANUFACTURER));
        report.put("device_model", safe(Build.MODEL));
        report.put("android_version", safe(Build.VERSION.RELEASE));
        report.put("android_sdk", Build.VERSION.SDK_INT);
        report.put("created_at", toIsoTime(System.currentTimeMillis()));

        String trimmed = stack == null ? "" : stack;
        while (true) {
            report.put("stack", trimmed);
            byte[] bytes = report.toString().getBytes(StandardCharsets.UTF_8);
            if (bytes.length <= MAX_REPORT_BYTES || trimmed.isEmpty()) {
                return bytes;
            }
            // 超出上限时对半收缩，快速逼近 256KB 且保证 stack 覆盖最大占比
            trimmed = trimmed.substring(0, trimmed.length() / 2);
        }
    }

    /** 写文件并在超过份数上限时删除最旧报告；失败时抛出异常。 */
    private static File writeReportFile(Context context, String kind, String message, String stack, String occurredAt, String view) throws Exception {
        File dir = getDiagnosticsDir(context);
        if (!dir.isDirectory() && !dir.mkdirs()) {
            throw new Exception("无法创建诊断目录");
        }

        byte[] bytes = buildReportBytes(context, kind, message, stack, occurredAt, view);
        File target = new File(dir, buildFileName());
        try (FileOutputStream out = new FileOutputStream(target)) {
            out.write(bytes);
            out.flush();
        }

        pruneOldReports(dir);
        return target;
    }

    private static String buildFileName() {
        String stamp = new SimpleDateFormat(FILE_TIME_PATTERN, Locale.US).format(new Date());
        int suffix = 1000 + RANDOM.nextInt(9000);
        return "report-" + stamp + "-" + suffix + ".json";
    }

    private static void pruneOldReports(File dir) {
        File[] files = dir.listFiles();
        if (files == null) {
            return;
        }
        List<File> reports = new ArrayList<>();
        for (File file : files) {
            if (file.isFile() && file.getName().endsWith(".json")) {
                reports.add(file);
            }
        }
        if (reports.size() <= MAX_REPORT_COUNT) {
            return;
        }
        reports.sort(Comparator.comparingLong(File::lastModified));
        int removeCount = reports.size() - MAX_REPORT_COUNT;
        for (int i = 0; i < removeCount; i++) {
            reports.get(i).delete();
        }
    }

    /**
     * 把私有目录中尚未转存的报告复制到已授权的 Bug 文件夹。
     * 文件名由私有报告名确定性映射，重试前先检查目标目录，避免重复文件。
     */
    static SyncResult syncReports(Context context) {
        synchronized (SYNC_LOCK) {
            File[] reports = listReportFiles(getDiagnosticsDir(context));
            if (reports.length == 0) {
                return new SyncResult(0, 0, "");
            }

            Uri folderUri = bugFolderUri(context);
            if (folderUri == null) {
                return new SyncResult(0, reports.length, "");
            }
            if (!hasPersistedReadWritePermission(context, folderUri)) {
                return new SyncResult(0, reports.length, "FOLDER_PERMISSION_REVOKED");
            }

            Uri parentUri;
            try {
                parentUri = treeDocumentUri(folderUri);
            } catch (Exception error) {
                return new SyncResult(0, reports.length, "EXPORT_WRITE_FAILED");
            }

            SharedPreferences preferences = prefs(context);
            Set<String> syncedIds = new HashSet<>(
                preferences.getStringSet(KEY_SYNCED_IDS, new HashSet<>())
            );
            Set<String> existingNames = childDisplayNames(context, folderUri);
            int syncedNow = 0;
            String reason = "";

            for (File report : reports) {
                if (syncedIds.contains(report.getName())) {
                    continue;
                }
                String targetName = bugFileName(report.getName());
                if (existingNames.contains(targetName)) {
                    syncedIds.add(report.getName());
                    continue;
                }

                Uri target = null;
                boolean written = false;
                try {
                    byte[] bytes = readReportBytes(report);
                    target = DocumentsContract.createDocument(
                        context.getContentResolver(),
                        parentUri,
                        "application/json",
                        targetName
                    );
                    if (target == null) {
                        targetName = conflictName(targetName);
                        target = DocumentsContract.createDocument(
                            context.getContentResolver(),
                            parentUri,
                            "application/json",
                            targetName
                        );
                    }
                    if (target == null) {
                        throw new IllegalStateException("createDocument returned null");
                    }
                    try (OutputStream out = context.getContentResolver().openOutputStream(target)) {
                        if (out == null) {
                            throw new IllegalStateException("openOutputStream returned null");
                        }
                        out.write(bytes);
                        out.flush();
                    }
                    String actualName = documentDisplayName(context, target);
                    existingNames.add(actualName.isEmpty() ? targetName : actualName);
                    syncedIds.add(report.getName());
                    written = true;
                    syncedNow++;
                } catch (Exception error) {
                    reason = "EXPORT_WRITE_FAILED";
                } finally {
                    if (!written && target != null) {
                        deleteQuietly(context, target);
                    }
                }
            }

            Set<String> currentIds = new HashSet<>();
            for (File report : reports) {
                currentIds.add(report.getName());
            }
            syncedIds.retainAll(currentIds);
            preferences.edit().putStringSet(KEY_SYNCED_IDS, syncedIds).apply();

            int pending = 0;
            for (File report : reports) {
                if (!syncedIds.contains(report.getName())) {
                    pending++;
                }
            }
            return new SyncResult(syncedNow, pending, reason);
        }
    }

    private static Set<String> childDisplayNames(Context context, Uri folderUri) {
        Set<String> names = new HashSet<>();
        try {
            Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
                folderUri,
                DocumentsContract.getTreeDocumentId(folderUri)
            );
            Cursor cursor = context.getContentResolver().query(
                childrenUri,
                new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},
                null,
                null,
                null
            );
            if (cursor == null) {
                return names;
            }
            try (Cursor closeable = cursor) {
                int column = closeable.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
                while (column >= 0 && closeable.moveToNext()) {
                    String name = closeable.getString(column);
                    if (name != null && !name.isEmpty()) {
                        names.add(name);
                    }
                }
            }
        } catch (Exception ignored) {
            // 查询失败时仍继续转存；确定性文件名与已转存集合继续承担主要去重职责。
        }
        return names;
    }

    private static String documentDisplayName(Context context, Uri documentUri) {
        try (Cursor cursor = context.getContentResolver().query(
            documentUri,
            new String[]{OpenableColumns.DISPLAY_NAME},
            null,
            null,
            null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (column >= 0) {
                    String name = cursor.getString(column);
                    return name == null ? "" : name;
                }
            }
        } catch (Exception ignored) {
            // 沿用请求名即可。
        }
        return "";
    }

    private static byte[] readReportBytes(File report) throws Exception {
        long length = Math.min(report.length(), MAX_REPORT_BYTES);
        byte[] bytes = new byte[(int) length];
        try (InputStream in = new FileInputStream(report)) {
            int offset = 0;
            while (offset < bytes.length) {
                int read = in.read(bytes, offset, bytes.length - offset);
                if (read < 0) {
                    break;
                }
                offset += read;
            }
            if (offset == bytes.length) {
                return bytes;
            }
            byte[] trimmed = new byte[offset];
            System.arraycopy(bytes, 0, trimmed, 0, offset);
            return trimmed;
        }
    }

    static String bugFileName(String reportName) {
        String suffix = reportName.startsWith(REPORT_FILE_PREFIX)
            ? reportName.substring(REPORT_FILE_PREFIX.length())
            : reportName;
        return BUG_FILE_PREFIX + suffix;
    }

    static String conflictName(String fileName) {
        String stamp = new SimpleDateFormat(FILE_TIME_PATTERN, Locale.US).format(new Date());
        int dot = fileName.lastIndexOf('.');
        if (dot > 0) {
            return fileName.substring(0, dot) + "-" + stamp + fileName.substring(dot);
        }
        return fileName + "-" + stamp;
    }

    private static void deleteQuietly(Context context, Uri documentUri) {
        try {
            DocumentsContract.deleteDocument(context.getContentResolver(), documentUri);
        } catch (Exception ignored) {
            // 清理是尽力而为，不能覆盖原始失败原因。
        }
    }

    static final class SyncResult {
        final int synced;
        final int pending;
        final String reason;

        SyncResult(int synced, int pending, String reason) {
            this.synced = synced;
            this.pending = pending;
            this.reason = reason == null ? "" : reason;
        }
    }

    private static String appVersionName(Context context) {
        try {
            PackageInfo info = packageInfo(context);
            return safe(info.versionName);
        } catch (Exception ignored) {
            return "";
        }
    }

    private static long appVersionCode(Context context) {
        try {
            PackageInfo info = packageInfo(context);
            return versionCodeOf(info);
        } catch (Exception ignored) {
            return 0L;
        }
    }

    // getPackageInfo(String, int) 在 API 33 起废弃，这里按版本选择入参类型。
    private static PackageInfo packageInfo(Context context) throws PackageManager.NameNotFoundException {
        PackageManager manager = context.getPackageManager();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return manager.getPackageInfo(context.getPackageName(), PackageManager.PackageInfoFlags.of(0));
        }
        return manager.getPackageInfo(context.getPackageName(), 0);
    }

    @SuppressWarnings("deprecation")
    private static long versionCodeOf(PackageInfo info) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return info.getLongVersionCode();
        }
        return info.versionCode;
    }

    private static String webViewVersion(Context context) {
        try {
            return safe(WebSettings.getDefaultUserAgent(context));
        } catch (Exception ignored) {
            return "";
        }
    }

    private static String toIsoTime(long millis) {
        return new SimpleDateFormat(ISO_TIME_PATTERN, Locale.US).format(new Date(millis));
    }

    private static String safe(String value) {
        return value == null ? "" : value;
    }
}
