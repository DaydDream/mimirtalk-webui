package io.github.dayddream.mimirtalk;

import android.app.Application;
import android.util.Log;

/**
 * 应用入口：挂钩未捕获异常处理器，把 Java 层崩溃先落一条诊断报告，再交给原有处理器。
 *
 * 写报告本身全包在 try/catch 内，绝不能在崩溃路径上二次抛出，避免把一次崩溃放大成
 * 冷启动即崩的死循环；真正终止进程仍由 previous 处理器（Android 默认实现）负责。
 */
public class MimirTalkApplication extends Application {

    @Override
    public void onCreate() {
        super.onCreate();

        // 上次进程结束前未转存成功的报告，在应用启动后异步补写一次。
        MimirDiagnosticsPlugin.scheduleSync(getApplicationContext());

        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
            try {
                String message = throwable.getClass().getName();
                if (throwable.getMessage() != null) {
                    message = message + ": " + throwable.getMessage();
                }
                MimirDiagnosticsPlugin.writeRawReport(
                    getApplicationContext(),
                    "java-uncaught",
                    message,
                    Log.getStackTraceString(throwable),
                    null,
                    null
                );
            } catch (Throwable ignored) {
                // 崩溃路径绝不能二次抛出
            }

            if (previous != null) {
                previous.uncaughtException(thread, throwable);
            } else {
                System.exit(1);
            }
        });
    }
}
