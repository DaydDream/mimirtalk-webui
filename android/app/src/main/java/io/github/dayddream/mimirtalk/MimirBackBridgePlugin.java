package io.github.dayddream.mimirtalk;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 前端导航状态到原生返回能力的最小桥。
 *
 * 前端只上报「当前最终返回能力」，不累积导航事件；原生只保留最新值。
 * WebView 重载后旧状态失效，由 {@link MainActivity} 在页面加载开始时统一重置为
 * unknown，等新页面挂载后重新上报，避免把未就绪状态误判为根页面。
 */
@CapacitorPlugin(name = "MimirBackBridge")
public class MimirBackBridgePlugin extends Plugin {

    @PluginMethod
    public void setBackState(PluginCall call) {
        MainActivity activity = mainActivity();
        if (activity == null) {
            call.reject("主界面不可用");
            return;
        }
        activity.applyBackState(call.getString("state"));
        call.resolve();
    }

    private MainActivity mainActivity() {
        if (getActivity() instanceof MainActivity) {
            return (MainActivity) getActivity();
        }
        return null;
    }
}
