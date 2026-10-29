package io.github.dayddream.mimirtalk;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Date;
import java.util.Locale;

/**
 * 长图导出插件：应用直接管理固定目录，不弹出 SAF 文件夹选择器。
 *
 * Android 10+ 写入 MediaStore 的 Pictures/MimirTalk；Android 7-9 写入公共图片目录，
 * 并只在旧系统上申请目录写入所需的存储权限。前端仍通过原有的 MimirFileSaver 契约调用。
 */
@CapacitorPlugin(
    name = "MimirFileSaver",
    permissions = {
        @Permission(
            strings = {Manifest.permission.WRITE_EXTERNAL_STORAGE},
            alias = MimirFixedFileSaverPlugin.STORAGE_PERMISSION_ALIAS
        )
    }
)
public class MimirFixedFileSaverPlugin extends Plugin {

    private static final String ERROR_EXPORT_WRITE_FAILED = "EXPORT_WRITE_FAILED";
    private static final String ERROR_INVALID_IMAGE = "INVALID_IMAGE";
    private static final String ERROR_INVALID_REQUEST = "INVALID_REQUEST";
    private static final String ERROR_STORAGE_PERMISSION_DENIED = "STORAGE_PERMISSION_DENIED";
    static final String STORAGE_PERMISSION_ALIAS = "storage";
    private static final String EXPORT_FOLDER_LABEL = "Pictures/MimirTalk";
    private static final String EXPORT_FOLDER_URI = "mimirtalk://pictures/MimirTalk";
    private static final String EXPORT_MIME_TYPE = "image/png";
    private static final String EXPORT_RELATIVE_PATH =
        Environment.DIRECTORY_PICTURES + "/MimirTalk/";
    private static final int MAX_EXPORT_BYTES = 32 * 1024 * 1024;
    private static final int MAX_EXPORT_IMAGES = 500;
    private static final int THUMBNAIL_MAX_EDGE = 480;
    private static final int MAX_FULL_IMAGE_BYTES = 32 * 1024 * 1024;
    private static final String ISO_TIME_PATTERN = "yyyy-MM-dd'T'HH:mm:ss.SSSZ";
    private static final byte[] PNG_SIGNATURE = new byte[]{
        (byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
    };

    @PluginMethod
    public void saveFile(PluginCall call) {
        final String data = call.getString("data");
        if (data == null || data.isEmpty()) {
            call.reject("缺少待保存的数据", ERROR_INVALID_REQUEST);
            return;
        }

        final byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            call.reject("导出数据不是有效的 base64", ERROR_INVALID_REQUEST, error);
            return;
        }
        if (bytes.length == 0 || bytes.length > MAX_EXPORT_BYTES) {
            call.reject("导出图片为空或超过 32 MiB", ERROR_INVALID_REQUEST);
            return;
        }
        if (!isPng(bytes)) {
            call.reject("导出内容不是有效的 PNG 图片", ERROR_INVALID_IMAGE);
            return;
        }

        final String fileName = call.getString("fileName", "mimirtalk.png");
        if (requiresLegacyStoragePermission()) {
            PermissionState state = getPermissionState(STORAGE_PERMISSION_ALIAS);
            if (state != PermissionState.GRANTED) {
                requestPermissionForAlias(
                    STORAGE_PERMISSION_ALIAS,
                    call,
                    "storagePermissionCallback"
                );
                return;
            }
        }
        getBridge().execute(() -> writeFixedExport(call, bytes, fileName));
    }

    @PermissionCallback
    private void storagePermissionCallback(PluginCall call) {
        if (getPermissionState(STORAGE_PERMISSION_ALIAS) != PermissionState.GRANTED) {
            call.reject(
                "需要允许存储权限才能写入 Pictures/MimirTalk",
                ERROR_STORAGE_PERMISSION_DENIED
            );
            return;
        }
        saveFile(call);
    }

    /** 兼容旧前端调用；固定目录无需用户选择或持久授权。 */
    @PluginMethod
    public void chooseFolder(PluginCall call) {
        call.resolve(fixedFolderResult());
    }

    @PluginMethod
    public void folderLabel(PluginCall call) {
        JSObject result = new JSObject();
        result.put("label", EXPORT_FOLDER_LABEL);
        result.put("folder_uri", EXPORT_FOLDER_URI);
        call.resolve(result);
    }

    /** 只枚举固定目录中由本应用生成、以 momotalk_ 开头的 PNG。 */
    @PluginMethod
    public void listExportImages(PluginCall call) {
        getBridge().execute(() -> {
            JSObject result = exportImageListResult("");
            JSArray images = new JSArray();
            result.put("images", images);
            result.put("folder_label", EXPORT_FOLDER_LABEL);
            result.put("folder_uri", EXPORT_FOLDER_URI);
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    listMediaStoreExports(images);
                } else {
                    listFileExports(images);
                }
                call.resolve(result);
            } catch (Exception error) {
                call.resolve(exportImageListResult("LIST_FAILED"));
            }
        });
    }

    @PluginMethod
    public void resolveExportImage(PluginCall call) {
        String rawUri = call.getString("uri");
        String size = call.getString("size", "thumbnail");
        if (rawUri == null || rawUri.isEmpty() ||
            (!"thumbnail".equals(size) && !"full".equals(size))) {
            call.resolve(exportImageResolveResult("INVALID_REQUEST"));
            return;
        }

        final Uri documentUri;
        try {
            documentUri = Uri.parse(rawUri);
            if (!isManagedExportUri(documentUri)) {
                call.resolve(exportImageResolveResult("INVALID_REQUEST"));
                return;
            }
        } catch (Exception error) {
            call.resolve(exportImageResolveResult("INVALID_REQUEST"));
            return;
        }

        final boolean thumbnail = "thumbnail".equals(size);
        getBridge().execute(() -> {
            try {
                call.resolve(
                    thumbnail ? readThumbnail(documentUri) : readFullImage(documentUri)
                );
            } catch (Exception error) {
                call.resolve(exportImageResolveResult("UNREADABLE"));
            }
        });
    }

    private void writeFixedExport(
        PluginCall call,
        byte[] bytes,
        String requestedFileName
    ) {
        String fileName = safePngName(requestedFileName);
        Uri targetUri = null;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                fileName = availableMediaStoreName(fileName);
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
                values.put(MediaStore.Images.Media.MIME_TYPE, EXPORT_MIME_TYPE);
                values.put(MediaStore.Images.Media.RELATIVE_PATH, EXPORT_RELATIVE_PATH);
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
                targetUri = getContext().getContentResolver().insert(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    values
                );
                if (targetUri == null) {
                    throw new IllegalStateException("MediaStore insert returned null");
                }
                try (OutputStream stream = getContext().getContentResolver().openOutputStream(targetUri)) {
                    if (stream == null) {
                        throw new IllegalStateException("openOutputStream returned null");
                    }
                    stream.write(bytes);
                    stream.flush();
                }
                values.clear();
                values.put(MediaStore.Images.Media.IS_PENDING, 0);
                getContext().getContentResolver().update(targetUri, values, null, null);
            } else {
                File directory = legacyExportDirectory();
                if (!directory.isDirectory() && !directory.mkdirs() && !directory.isDirectory()) {
                    throw new IllegalStateException("cannot create export directory");
                }
                File target = availableLegacyFile(directory, fileName);
                fileName = target.getName();
                try (OutputStream stream = new FileOutputStream(target)) {
                    stream.write(bytes);
                    stream.flush();
                }
                targetUri = Uri.fromFile(target);
                MediaScannerConnection.scanFile(
                    getContext(),
                    new String[]{target.getAbsolutePath()},
                    new String[]{EXPORT_MIME_TYPE},
                    null
                );
            }

            JSObject result = fixedFolderResult();
            result.put("uri", targetUri.toString());
            result.put("name", fileName);
            call.resolve(result);
        } catch (Exception error) {
            if (targetUri != null) {
                deleteQuietly(targetUri);
            }
            call.reject("图片保存失败，请检查设备存储空间", ERROR_EXPORT_WRITE_FAILED, error);
        }
    }

    private JSObject fixedFolderResult() {
        JSObject result = new JSObject();
        result.put("selected", true);
        result.put("folder_label", EXPORT_FOLDER_LABEL);
        result.put("folder_uri", EXPORT_FOLDER_URI);
        return result;
    }

    private void listMediaStoreExports(JSArray images) {
        ContentResolver resolver = getContext().getContentResolver();
        String[] projection = new String[]{
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.DATE_ADDED,
            MediaStore.Images.Media.DATE_MODIFIED,
            MediaStore.Images.Media.MIME_TYPE,
        };
        int count = 0;
        try (Cursor cursor = resolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            projection,
            MediaStore.Images.Media.RELATIVE_PATH + "=?",
            new String[]{EXPORT_RELATIVE_PATH},
            MediaStore.Images.Media.DATE_MODIFIED + " DESC"
        )) {
            while (cursor != null && cursor.moveToNext() && count < MAX_EXPORT_IMAGES) {
                String name = cursorString(cursor, MediaStore.Images.Media.DISPLAY_NAME);
                String mimeType = cursorString(cursor, MediaStore.Images.Media.MIME_TYPE);
                if (!isOwnExportName(name) ||
                    (!mimeType.isEmpty() && !"image/png".equalsIgnoreCase(mimeType))) {
                    continue;
                }
                long id = cursorLong(cursor, MediaStore.Images.Media._ID);
                if (id <= 0) {
                    continue;
                }
                Uri uri = ContentUris.withAppendedId(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    id
                );
                JSObject item = exportItem(uri, name);
                long modified = cursorLong(cursor, MediaStore.Images.Media.DATE_MODIFIED);
                long added = cursorLong(cursor, MediaStore.Images.Media.DATE_ADDED);
                String modifiedTime = toIsoTime(modified > 0 ? modified * 1000L : 0L);
                String addedTime = toIsoTime(added > 0 ? added * 1000L : 0L);
                if (!modifiedTime.isEmpty()) item.put("modified_at", modifiedTime);
                if (!addedTime.isEmpty()) item.put("created_at", addedTime);
                fillPngInfo(resolver, uri, item);
                images.put(item);
                count += 1;
            }
        }
    }

    private void listFileExports(JSArray images) {
        File directory = legacyExportDirectory();
        File[] files = directory.isDirectory() ? directory.listFiles() : null;
        if (files == null || files.length == 0) {
            return;
        }
        Arrays.sort(files, Comparator.comparingLong(File::lastModified).reversed());
        int count = 0;
        for (File file : files) {
            if (count >= MAX_EXPORT_IMAGES) {
                break;
            }
            if (!file.isFile() || !isOwnExportName(file.getName())) {
                continue;
            }
            Uri uri = Uri.fromFile(file);
            JSObject item = exportItem(uri, file.getName());
            String modifiedTime = toIsoTime(file.lastModified());
            if (!modifiedTime.isEmpty()) {
                item.put("created_at", modifiedTime);
                item.put("modified_at", modifiedTime);
            }
            fillPngInfo(getContext().getContentResolver(), uri, item);
            images.put(item);
            count += 1;
        }
    }

    private JSObject exportItem(Uri uri, String name) {
        JSObject item = new JSObject();
        item.put("uri", uri.toString());
        item.put("name", name);
        return item;
    }

    private boolean isManagedExportUri(Uri uri) {
        if (uri == null) {
            return false;
        }
        if ("file".equalsIgnoreCase(uri.getScheme())) {
            File target = new File(uri.getPath());
            String root = legacyExportDirectory().getAbsolutePath();
            String path = target.getAbsolutePath();
            return isOwnExportName(target.getName()) &&
                (path.equals(root) || path.startsWith(root + File.separator));
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            !"content".equalsIgnoreCase(uri.getScheme()) ||
            !MediaStore.AUTHORITY.equals(uri.getAuthority())) {
            return false;
        }
        long id;
        try {
            id = ContentUris.parseId(uri);
        } catch (Exception error) {
            return false;
        }
        try (Cursor cursor = getContext().getContentResolver().query(
            uri,
            new String[]{
                MediaStore.Images.Media.DISPLAY_NAME,
                MediaStore.Images.Media.MIME_TYPE,
            },
            MediaStore.Images.Media.RELATIVE_PATH + "=?",
            new String[]{EXPORT_RELATIVE_PATH},
            null
        )) {
            if (cursor == null || !cursor.moveToFirst() || id <= 0) {
                return false;
            }
            String name = cursorString(cursor, MediaStore.Images.Media.DISPLAY_NAME);
            String mimeType = cursorString(cursor, MediaStore.Images.Media.MIME_TYPE);
            return isOwnExportName(name) &&
                (mimeType.isEmpty() || "image/png".equalsIgnoreCase(mimeType));
        } catch (Exception error) {
            return false;
        }
    }

    private String availableMediaStoreName(String fileName) {
        String candidate = fileName;
        int suffix = 1;
        while (mediaStoreNameExists(candidate)) {
            candidate = uniqueName(fileName, new Date(System.currentTimeMillis() + suffix));
            suffix += 1;
        }
        return candidate;
    }

    private boolean mediaStoreNameExists(String fileName) {
        try (Cursor cursor = getContext().getContentResolver().query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            new String[]{MediaStore.Images.Media._ID},
            MediaStore.Images.Media.RELATIVE_PATH + "=? AND " +
                MediaStore.Images.Media.DISPLAY_NAME + "=?",
            new String[]{EXPORT_RELATIVE_PATH, fileName},
            null
        )) {
            return cursor != null && cursor.moveToFirst();
        }
    }

    private File availableLegacyFile(File directory, String fileName) {
        File target = new File(directory, fileName);
        if (!target.exists()) {
            return target;
        }
        int suffix = 1;
        do {
            target = new File(
                directory,
                uniqueName(fileName, new Date(System.currentTimeMillis() + suffix))
            );
            suffix += 1;
        } while (target.exists());
        return target;
    }

    private File legacyExportDirectory() {
        File root = Environment.getExternalStoragePublicDirectory(
            Environment.DIRECTORY_PICTURES
        );
        return new File(root, "MimirTalk");
    }

    private String safePngName(String requestedFileName) {
        String name = requestedFileName == null ? "" : requestedFileName.trim();
        int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
        if (slash >= 0) {
            name = name.substring(slash + 1);
        }
        if (name.isEmpty()) {
            name = "momotalk_export.png";
        }
        if (!name.toLowerCase(Locale.US).endsWith(".png")) {
            name += ".png";
        }
        return name;
    }

    private boolean isOwnExportName(String name) {
        if (name == null) {
            return false;
        }
        String lower = name.toLowerCase(Locale.US);
        return lower.startsWith("momotalk_") && lower.endsWith(".png");
    }

    private String cursorString(Cursor cursor, String column) {
        int index = cursor.getColumnIndex(column);
        if (index < 0) {
            return "";
        }
        String value = cursor.getString(index);
        return value == null ? "" : value;
    }

    private long cursorLong(Cursor cursor, String column) {
        int index = cursor.getColumnIndex(column);
        return index >= 0 ? cursor.getLong(index) : 0L;
    }

    private void fillPngInfo(ContentResolver resolver, Uri documentUri, JSObject item) {
        boolean readable = false;
        try (InputStream stream = openInputStream(resolver, documentUri)) {
            if (stream != null) {
                byte[] header = new byte[24];
                int read = 0;
                while (read < header.length) {
                    int count = stream.read(header, read, header.length - read);
                    if (count <= 0) {
                        break;
                    }
                    read += count;
                }
                int[] dimensions = pngDimensions(header, read);
                if (dimensions != null) {
                    item.put("width", dimensions[0]);
                    item.put("height", dimensions[1]);
                    readable = true;
                }
            }
        } catch (Exception ignored) {
            // 损坏项仍显示占位，便于用户识别并重新导出。
        }
        item.put("readable", readable);
    }

    private JSObject readThumbnail(Uri documentUri) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream stream = openInputStream(resolver, documentUri)) {
            BitmapFactory.decodeStream(stream, null, bounds);
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            return exportImageResolveResult("UNREADABLE");
        }

        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sampleSizeFor(bounds.outWidth, bounds.outHeight, THUMBNAIL_MAX_EDGE);
        Bitmap bitmap;
        try (InputStream stream = openInputStream(resolver, documentUri)) {
            bitmap = BitmapFactory.decodeStream(stream, null, options);
        }
        if (bitmap == null) {
            return exportImageResolveResult("UNREADABLE");
        }

        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try {
            if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes)) {
                return exportImageResolveResult("UNREADABLE");
            }
        } finally {
            bitmap.recycle();
        }
        JSObject result = new JSObject();
        result.put("data", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
        result.put("mime_type", "image/png");
        result.put("width", bounds.outWidth);
        result.put("height", bounds.outHeight);
        return result;
    }

    private JSObject readFullImage(Uri documentUri) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (InputStream stream = openInputStream(resolver, documentUri)) {
            if (stream == null) {
                return exportImageResolveResult("UNREADABLE");
            }
            byte[] buffer = new byte[64 * 1024];
            int total = 0;
            int read;
            while ((read = stream.read(buffer)) > 0) {
                total += read;
                if (total > MAX_FULL_IMAGE_BYTES) {
                    return exportImageResolveResult("IMAGE_TOO_LARGE");
                }
                bytes.write(buffer, 0, read);
            }
        }
        byte[] data = bytes.toByteArray();
        int[] dimensions = pngDimensions(data, Math.min(data.length, 24));
        if (dimensions == null) {
            return exportImageResolveResult("UNREADABLE");
        }
        JSObject result = new JSObject();
        result.put("data", Base64.encodeToString(data, Base64.NO_WRAP));
        result.put("mime_type", "image/png");
        result.put("width", dimensions[0]);
        result.put("height", dimensions[1]);
        return result;
    }

    private InputStream openInputStream(ContentResolver resolver, Uri uri) throws Exception {
        if ("file".equalsIgnoreCase(uri.getScheme())) {
            return new FileInputStream(new File(uri.getPath()));
        }
        return resolver.openInputStream(uri);
    }

    private JSObject exportImageListResult(String reason) {
        JSObject result = new JSObject();
        result.put("images", new JSArray());
        result.put("folder_label", EXPORT_FOLDER_LABEL);
        result.put("folder_uri", EXPORT_FOLDER_URI);
        if (reason != null && !reason.isEmpty()) {
            result.put("reason", reason);
        }
        return result;
    }

    private JSObject exportImageResolveResult(String reason) {
        JSObject result = new JSObject();
        result.put("url", "");
        if (reason != null && !reason.isEmpty()) {
            result.put("reason", reason);
        }
        return result;
    }

    static boolean isPng(byte[] data) {
        return pngDimensions(data, data == null ? 0 : data.length) != null;
    }

    private boolean requiresLegacyStoragePermission() {
        return Build.VERSION.SDK_INT <= Build.VERSION_CODES.P;
    }

    static int[] pngDimensions(byte[] data, int length) {
        if (data == null || length < 24) {
            return null;
        }
        for (int index = 0; index < PNG_SIGNATURE.length; index += 1) {
            if (data[index] != PNG_SIGNATURE[index]) {
                return null;
            }
        }
        if (readInt(data, 8) != 13 ||
            data[12] != 'I' ||
            data[13] != 'H' ||
            data[14] != 'D' ||
            data[15] != 'R') {
            return null;
        }
        int width = readInt(data, 16);
        int height = readInt(data, 20);
        if (width <= 0 || height <= 0) {
            return null;
        }
        return new int[]{width, height};
    }

    private static int readInt(byte[] data, int offset) {
        return ((data[offset] & 0xff) << 24) |
            ((data[offset + 1] & 0xff) << 16) |
            ((data[offset + 2] & 0xff) << 8) |
            (data[offset + 3] & 0xff);
    }

    private int sampleSizeFor(int width, int height, int maxEdge) {
        int sample = 1;
        while (Math.max(width / sample, height / sample) > maxEdge) {
            sample *= 2;
        }
        return sample;
    }

    private String toIsoTime(long millis) {
        if (millis <= 0) {
            return "";
        }
        return new SimpleDateFormat(ISO_TIME_PATTERN, Locale.US).format(new Date(millis));
    }

    private void deleteQuietly(Uri uri) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
                "content".equalsIgnoreCase(uri.getScheme())) {
                getContext().getContentResolver().delete(uri, null, null);
            } else if ("file".equalsIgnoreCase(uri.getScheme())) {
                File file = new File(uri.getPath());
                if (file.isFile()) {
                    file.delete();
                }
            }
        } catch (Exception ignored) {
            // 清理失败不覆盖原始保存错误。
        }
    }

    /** 重名时在扩展名前插入时间戳。 */
    static String uniqueName(String fileName, Date now) {
        String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss-SSS", Locale.US).format(now);
        int dot = fileName.lastIndexOf('.');
        if (dot > 0) {
            return fileName.substring(0, dot) + "-" + stamp + fileName.substring(dot);
        }
        return fileName + "-" + stamp;
    }
}
