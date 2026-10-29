package io.github.dayddream.mimirtalk;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import androidx.activity.BackEventCompat;
import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    static final String BACK_STATE_UNKNOWN = "unknown";
    static final String BACK_STATE_CAN_GO_BACK = "can-go-back";
    static final String BACK_STATE_ROOT = "root";

    /** JS 桥接未按时返回时放弃本次返回，避免一次返回被迟到回调重复触发。 */
    private static final long BACK_BRIDGE_TIMEOUT_MS = 1500L;

    /**
     * 返回能力查询脚本只做三态判定：handled / root / unknown。
     * 不允许用 goBack() 的结果反推能否返回，避免查询动作改变页面状态。
     */
    private static final String BACK_SCRIPT =
        "(function(){try{"
            + "var shell=window.MimirTalkShell;"
            + "if(!shell||typeof shell.canGoBack!=='function'||typeof shell.goBack!=='function'){return 'unknown';}"
            + "if(shell.canGoBack()!==true){return 'root';}"
            + "return shell.goBack()===true?'handled':'unknown';"
            + "}catch(error){return 'unknown';}})()";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private OnBackPressedCallback backCallback;
    private String backState = BACK_STATE_UNKNOWN;
    private boolean backPending = false;
    private boolean predictiveGestureInProgress = false;
    private long backRequestId = 0L;
    private Runnable backTimeout = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MimirFixedFileSaverPlugin.class);
        registerPlugin(MimirDiagnosticsPlugin.class);
        registerPlugin(MimirBackBridgePlugin.class);

        // WebView 渲染进程被杀/崩溃（API 26+ 才会回调）时先落一条诊断报告，标注已处理
        bridgeBuilder.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageStarted(WebView webView) {
                // 重载期间旧页面的返回状态不再可信；在新页面重新上报前保持 unknown。
                resetBackStateForReload();
            }

            @Override
            public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                String message = "WebView 渲染进程终止，didCrash=" + (detail != null && detail.didCrash());
                MimirDiagnosticsPlugin.writeRawReport(
                    getApplicationContext(),
                    "webview-render-gone",
                    message,
                    null,
                    null,
                    null
                );
                resetBackStateForReload();
                return true;
            }
        });

        super.onCreate(savedInstanceState);

        backCallback = new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackStarted(BackEventCompat backEvent) {
                // 只标记系统手势已开始，不在预览阶段驱动前端或改变页面。
                if (!backPending) {
                    predictiveGestureInProgress = true;
                }
            }

            @Override
            public void handleOnBackProgressed(BackEventCompat backEvent) {
                // 本阶段不做手势跟随动画，进度只用于系统预测性返回流程。
            }

            @Override
            public void handleOnBackCancelled() {
                // 用户取消时仅清除手势状态，绝不调用 goBack() 或 finish()。
                predictiveGestureInProgress = false;
            }

            @Override
            public void handleOnBackPressed() {
                predictiveGestureInProgress = false;
                handleSystemBack();
            }
        };
        getOnBackPressedDispatcher().addCallback(this, backCallback);
        syncBackCallbackEnabled();
    }

    /**
     * 前端每次导航状态变化后经 MimirBackBridge 调用，只保留最新最终状态。
     */
    void applyBackState(String state) {
        final String next = normalizeBackState(state);
        runOnMainThread(() -> {
            updateBackState(next, "frontend-report");
            syncBackCallbackEnabled();
        });
    }

    private static String normalizeBackState(String state) {
        if (BACK_STATE_CAN_GO_BACK.equals(state)) {
            return BACK_STATE_CAN_GO_BACK;
        }
        if (BACK_STATE_ROOT.equals(state)) {
            return BACK_STATE_ROOT;
        }
        return BACK_STATE_UNKNOWN;
    }

    private void resetBackStateForReload() {
        runOnMainThread(() -> {
            updateBackState(BACK_STATE_UNKNOWN, "page-reload");
            predictiveGestureInProgress = false;
            invalidatePendingBack();
            syncBackCallbackEnabled();
        });
    }

    private void syncBackCallbackEnabled() {
        if (backCallback == null) {
            return;
        }
        // root 交还系统默认返回（退出 Activity）；unknown 仍由本回调接管，
        // 桥接就绪前绝不把未知状态当成根页面。
        if (BACK_STATE_ROOT.equals(backState)) {
            predictiveGestureInProgress = false;
        }
        backCallback.setEnabled(!BACK_STATE_ROOT.equals(backState));
    }

    private void handleSystemBack() {
        predictiveGestureInProgress = false;
        if (backPending) {
            return;
        }
        if (bridge == null || bridge.getWebView() == null) {
            // 桥尚未就绪时吞掉本次返回，等前端上报或页面就绪后再恢复。
            return;
        }

        final long requestId = ++backRequestId;
        backPending = true;
        scheduleBackTimeout(requestId);
        bridge.getWebView().evaluateJavascript(BACK_SCRIPT, value -> {
            // 超时后旧回调即使迟到，也不能再次触发 finish()。
            if (requestId != backRequestId) {
                return;
            }
            cancelPendingBack();
            handleBackScriptResult(value);
        });
    }

    private void handleBackScriptResult(String value) {
        String result = parseBackScriptResult(value);
        if ("handled".equals(result)) {
            return;
        }
        if ("root".equals(result)) {
            updateBackState(BACK_STATE_ROOT, "native-root-confirmed");
            syncBackCallbackEnabled();
            finish();
            return;
        }
        // unknown：桥未就绪或前端状态不可用。若原状态声称可返回，则降级为未知，
        // 等前端下一次上报恢复，避免反复按返回时重复调用 goBack()。
        if (BACK_STATE_CAN_GO_BACK.equals(backState)) {
            updateBackState(BACK_STATE_UNKNOWN, "frontend-state-unavailable");
            syncBackCallbackEnabled();
        }
    }

    /**
     * 只保留最新三态，并在状态实际变化时写入不含用户内容的诊断事件。
     */
    private void updateBackState(String next, String reason) {
        if (backState.equals(next)) {
            return;
        }
        backState = next;
        MimirDiagnosticsPlugin.writeRawReport(
            getApplicationContext(),
            "predictive-back-state",
            "state=" + next + ";reason=" + reason,
            null,
            null,
            null
        );
    }

    /** evaluateJavascript 返回 JSON 字符串，这里只接受脚本约定的三个纯文本结果。 */
    private static String parseBackScriptResult(String value) {
        if (value == null) {
            return "";
        }
        String trimmed = value.trim();
        if (trimmed.length() >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
            trimmed = trimmed.substring(1, trimmed.length() - 1);
        }
        return trimmed;
    }

    private void scheduleBackTimeout(long requestId) {
        removeBackTimeout();
        backTimeout = () -> {
            if (requestId != backRequestId) {
                return;
            }
            // 递增请求序号后，旧 JS 回调即使迟到也会在入口处被丢弃。
            backRequestId += 1L;
            backPending = false;
            backTimeout = null;
        };
        mainHandler.postDelayed(backTimeout, BACK_BRIDGE_TIMEOUT_MS);
    }

    private void cancelPendingBack() {
        removeBackTimeout();
        backPending = false;
    }

    /** 页面重载或渲染进程恢复时作废未决请求，防止旧 JS 回调继续执行。 */
    private void invalidatePendingBack() {
        backRequestId += 1L;
        cancelPendingBack();
    }

    private void removeBackTimeout() {
        if (backTimeout != null) {
            mainHandler.removeCallbacks(backTimeout);
            backTimeout = null;
        }
    }

    private void runOnMainThread(Runnable action) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            action.run();
            return;
        }
        mainHandler.post(action);
    }
}
