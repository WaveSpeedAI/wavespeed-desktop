# Desktop & Mobile 统一发版方案

## 目标

修改 Desktop 代码后，一次操作同时发布 Desktop（Win/Mac/Linux）和 Mobile（Android）。

---

## 一、代码层面：Mobile Override 合并

### 问题

Mobile 通过 Vite alias 覆写了 Desktop 的 13 个文件。当 Desktop 更新这些文件时，Mobile 不会收到改动，必须手动同步。

### 解决

将 13 个覆写文件合并为 2 个，通过条件判断（`isCapacitorNative()`）让同一份代码兼容两个平台。

| 覆写文件                             | 合并前               | 合并后                   |
| ------------------------------------ | -------------------- | ------------------------ |
| slider, PromptOptimizer, DynamicForm | 3 个独立 mobile 版本 | 合并到 Desktop 代码      |
| 4 个 Worker Hooks                    | 4 个独立 mobile 版本 | 合并到 Desktop 代码      |
| API client                           | 独立 mobile 版本     | 合并到 Desktop 代码      |
| FormField, SizeSelector              | 独立 mobile 版本     | 合并到 Desktop 代码      |
| FileUpload, AudioRecorder            | 独立 mobile 版本     | 合并到 Desktop 代码      |
| **SettingsPage**                     | 独立 mobile 版本     | **保留覆写**（差异过大） |
| **i18n**                             | 独立 mobile 版本     | **保留覆写**（架构不同） |

**结果：13 → 2 个覆写文件（减少 85%）。** Desktop 日常开发的改动会自动同步到 Mobile。

### 仍需手动同步的 2 个文件

| 文件                         | 保留覆写的原因                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/pages/SettingsPage.tsx` | Desktop 有 Electron 自动更新、SD 模型管理；Mobile 有 APK 下载更新、Cache API、WASM 模型预下载。功能差异 >40% |
| `src/i18n/index.ts`          | Mobile 通过 deepMerge 扩展 Desktop 翻译，架构层面不同                                                        |

CI 中已加入检测：如果这 2 个文件在 Desktop 端被修改，构建时会输出警告提醒手动同步。

---

## 二、CI 层面：统一发版流程

### 发版操作

```bash
# 1. 修改代码并提交
git add . && git commit -m "feat: ..."

# 2. 更新 package.json 版本号（如 1.0.48）

# 3. 打 tag 并推送
git tag v1.0.48
git push origin main --tags
```

### 自动触发的流程

```
push tag v1.0.48
       │
       ├── build.yml (Desktop)
       │   ├── 构建 Windows / macOS / Linux
       │   ├── 创建 GitHub Release
       │   └── 部署到生产服务器
       │
       └── mobile.yml (Mobile)
           ├── 检测覆写文件冲突（警告）
           ├── 自动同步版本号到 mobile/package.json + build.gradle
           ├── 构建 Android APK
           └── 追加 APK 到同一个 GitHub Release
```

### 产物

一个 GitHub Release 包含所有平台安装包：

| 文件                                    | 平台                  |
| --------------------------------------- | --------------------- |
| WaveSpeed-Desktop-win-x64.exe           | Windows               |
| WaveSpeed-Desktop-mac-x64.dmg           | macOS Intel           |
| WaveSpeed-Desktop-mac-arm64.dmg         | macOS Apple Silicon   |
| WaveSpeed-Desktop-linux-x86_64.AppImage | Linux                 |
| WaveSpeed-Mobile-{version}.apk          | Android（带版本号）   |
| WaveSpeed-Mobile.apk                    | Android（固定链接用） |

### 版本号

Mobile 版本号自动跟随 Desktop。CI 中自动完成：

- `package.json` version → `mobile/package.json` version
- `package.json` version → `build.gradle` versionName + versionCode
- versionCode 计算公式：`major × 10000 + minor × 100 + patch`（如 1.0.48 → 10048）

---

## 三、README 下载链接

所有平台均有一键下载徽章，指向 `/releases/latest/download/`，永远是最新版本：

| 平台          | 链接                                                               |
| ------------- | ------------------------------------------------------------------ |
| Windows       | `releases/latest/download/WaveSpeed-Desktop-win-x64.exe`           |
| macOS Intel   | `releases/latest/download/WaveSpeed-Desktop-mac-x64.dmg`           |
| macOS Silicon | `releases/latest/download/WaveSpeed-Desktop-mac-arm64.dmg`         |
| Linux         | `releases/latest/download/WaveSpeed-Desktop-linux-x86_64.AppImage` |
| Android       | `releases/latest/download/WaveSpeed-Mobile.apk`                    |

---

## 四、自动升级

### Desktop

| 功能             | 支持                       |
| ---------------- | -------------------------- |
| 后台自动检查更新 | ✅ 启动后 3 秒自动检查     |
| 应用内下载       | ✅ 后台静默下载，显示进度  |
| 自动安装         | ✅ 退出时自动安装新版本    |
| 更新频道         | ✅ Stable / Nightly 可切换 |

### Mobile

| 功能           | 支持                                 |
| -------------- | ------------------------------------ |
| 手动检查更新   | ✅ Settings → 检查更新               |
| 应用内下载 APK | ✅ 下载到 Downloads 文件夹，显示进度 |
| 自动安装       | ❌ 需用户手动点击 APK 安装           |
| 后台自动检查   | ❌ 需用户主动触发                    |

### Mobile 自动升级的限制

Android 侧载（sideload）应用无法实现静默自动更新，这是 Android 系统层面的限制：

1. **安装权限**：非应用商店安装的 APK，系统要求用户手动确认安装
2. **后台限制**：Android 不允许 WebView 应用在后台持续运行检查更新
3. **安全策略**：APK 自动替换需要系统级权限，普通应用无法获取

**如需实现 Mobile 真正的自动更新，需要上架 Google Play Store。** Google Play 提供：

- 后台自动下载更新
- Wi-Fi 下静默安装
- 灰度发布 / 分阶段推送
- 崩溃报告和性能监控

---

## 五、耦合关系

Desktop 和 Mobile 代码互不影响：

```
Desktop 构建：src/* → Electron → 不碰 mobile/ 目录
Mobile 构建： src/* + 2个 alias 覆写 → Capacitor → Android APK
```

- Mobile 的条件判断（`isCapacitorNative()`）在 Desktop 环境永远返回 `false`，Desktop 行为不变
- Mobile 覆写文件只在 Mobile 构建时生效，Desktop 构建完全忽略
- 两条 CI 流水线独立运行，互不依赖
