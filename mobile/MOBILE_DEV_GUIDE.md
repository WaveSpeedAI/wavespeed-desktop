# WaveSpeed Mobile 开发指南

## 项目概述

WaveSpeed Mobile 是基于 Capacitor 6 的混合移动应用，复用桌面端 React 代码，通过文件覆盖机制实现移动端定制。

## 技术栈

- **Capacitor 6** - 混合应用框架
- **React 18** + **TypeScript** - 前端框架
- **Vite** - 构建工具
- **Tailwind CSS** + **shadcn/ui** - UI 组件
- **Zustand** - 状态管理
- **i18next** - 国际化

## 项目结构

```
wavespeed-desktop/
├── src/                           # 共享源码（桌面端 + 移动端）
│   ├── components/
│   │   └── playground/
│   │       ├── BatchOutputGrid.tsx   # 批量生成结果网格
│   │       ├── BatchControls.tsx     # 批量生成控制
│   │       └── OutputDisplay.tsx     # 输出显示
│   └── i18n/
│       └── locales/
│           ├── en.json              # 英文翻译
│           └── zh-CN.json           # 中文翻译
│
├── mobile/
│   ├── src/                       # 移动端覆盖文件
│   │   ├── pages/
│   │   │   └── MobilePlaygroundPage.tsx  # 移动端 Playground
│   │   ├── platform/
│   │   │   └── index.ts           # 平台服务（Capacitor API 封装）
│   │   ├── components/
│   │   │   └── playground/
│   │   │       ├── FileUpload.tsx     # 文件上传组件
│   │   │       └── PromptOptimizer.tsx
│   │   └── i18n/
│   │       └── index.ts           # 移动端 i18n 配置
│   │
│   ├── android/                   # Android 原生项目
│   │   ├── app/
│   │   │   ├── src/main/
│   │   │   │   ├── java/ai/wavespeed/mobile/
│   │   │   │   │   └── MainActivity.java  # Android 入口
│   │   │   │   ├── AndroidManifest.xml
│   │   │   │   └── assets/public/    # Web 资源（构建后）
│   │   │   └── build/outputs/apk/debug/
│   │   │       └── app-debug.apk     # 调试 APK
│   │   └── local.properties          # Android SDK 路径配置
│   │
│   ├── capacitor.config.ts        # Capacitor 配置
│   ├── vite.config.ts             # Vite 配置（含路径别名覆盖）
│   └── package.json
```

## 文件覆盖机制

`mobile/vite.config.ts` 中配置了路径别名，移动端文件会覆盖共享文件：

```typescript
resolve: {
  alias: {
    '@': path.resolve(__dirname, './src'),  // 优先使用 mobile/src
    // 如果 mobile/src 没有，回退到 ../src
  }
}
```

## 开发流程

### 1. 启动开发服务器

```bash
cd mobile
npm run dev
```

访问 http://localhost:5173

### 2. 构建 APK

```bash
# 1. 构建 Web 资源
cd mobile
npm run build

# 2. 同步到 Android
npx cap sync android

# 3. 构建 APK
cd android
./gradlew assembleDebug
```

APK 输出位置：`mobile/android/app/build/outputs/apk/debug/app-debug.apk`

### 3. 首次构建前配置

如果 `local.properties` 不存在，需要创建：

```properties
# mobile/android/local.properties
sdk.dir=C:\\Users\\你的用户名\\AppData\\Local\\Android\\Sdk
```

## 已解决的问题

### 1. Android 文件选择器不工作

**问题**：点击 `<input type="file">` 无反应

**原因**：Android WebView 需要实现 `WebChromeClient.onShowFileChooser`

**解决**：修改 `MainActivity.java`，添加：

- `fileChooserLauncher` - 文件选择器启动器
- `onShowFileChooser` - 处理文件选择回调

### 2. 外部 URL 下载

**问题**：批量生成的图片（外部 URL）无法下载

**原因**：Android WebView 中 `<a download>` 对跨域 URL 无效

**解决**：使用 `platformService.openExternal(url)` 跳转浏览器下载

### 3. Dialog 无障碍警告

**问题**：Dialog 组件缺少 `DialogDescription`

**解决**：为所有 Dialog 添加 `<DialogDescription className="sr-only">`

### 4. 批量生成集成

**修改文件**：`mobile/src/pages/MobilePlaygroundPage.tsx`

- 导入 `BatchControls` 和 `BatchOutputGrid`
- 添加 `runBatch`, `clearBatchResults` 到 store
- 修改 `handleRun` 检查 `batchConfig`
- 添加批量结果的历史保存逻辑

## Capacitor 插件

已安装的插件：

- `@capacitor/camera` - 相机/相册访问
- `@capacitor/filesystem` - 文件系统操作
- `@capacitor/preferences` - 本地存储
- `@capacitor/browser` - 打开外部浏览器
- `@capacitor/share` - 分享功能
- `@capacitor/keyboard` - 键盘事件
- `@capacitor/splash-screen` - 启动屏
- `@capacitor/status-bar` - 状态栏

## 平台服务 API

`mobile/src/platform/index.ts` 封装了平台相关 API：

```typescript
const platformService = getPlatformService();

// 存储
await platformService.getApiKey();
await platformService.setApiKey(key);
await platformService.getSettings();
await platformService.setSettings(settings);

// 文件
await platformService.saveAsset(url, type, fileName, subDir);
await platformService.deleteAsset(filePath);
await platformService.downloadFile(url, filename);

// 外部链接
await platformService.openExternal(url);

// 平台信息
platformService.getPlatform(); // 'capacitor' | 'web'
platformService.isMobile();
```

## 桌面端 vs 移动端功能差异

| 功能               | 桌面端 | 移动端                 |
| ------------------ | ------ | ---------------------- |
| Face Enhancer 模型 | 有     | 无（内存限制）         |
| Background Remover | 有     | 有                     |
| SAM 分割           | 有     | 有                     |
| 批量生成           | 有     | 有                     |
| 本地模型推理       | 有     | 有（ONNX Runtime Web） |

## 注意事项

1. **修改共享代码**：修改 `src/` 下的文件会同时影响桌面端和移动端
2. **移动端专属修改**：放在 `mobile/src/` 下，会覆盖对应的共享文件
3. **每次修改后**：需要重新 `npm run build` + `npx cap sync android` + `gradlew assembleDebug`
4. **翻译文件**：共享翻译在 `src/i18n/locales/`，移动端专属在 `mobile/src/i18n/`
5. **Android 权限**：在 `AndroidManifest.xml` 中配置

## 常用命令

```bash
# 开发
cd mobile && npm run dev

# 构建 APK（一条命令）
cd mobile && npm run build && npx cap sync android && cd android && ./gradlew assembleDebug

# 安装到连接的设备
cd mobile/android && ./gradlew installDebug

# 查看日志
adb logcat | grep -i capacitor
```

## iOS 支持说明

目前 WaveSpeed Mobile 仅支持 Android。以下是 iOS 支持的考虑因素和挑战。

### Android vs iOS 对比

| 项目       | Android           | iOS               |
| ---------- | ----------------- | ----------------- |
| 开发者费用 | $25 一次性        | $99/年            |
| 审核时间   | 几小时~2天        | 1~7天             |
| 审核严格度 | 相对宽松          | 非常严格          |
| 侧载安装   | ✅ 支持 APK       | ❌ 不支持         |
| 分发方式   | APK / Google Play | 仅 App Store      |
| 测试分发   | 直接分享 APK      | 必须用 TestFlight |

### App Store 常见拒绝原因

1. **隐私政策缺失** - 必须提供隐私政策 URL
2. **权限说明不清** - 必须解释为什么需要相机/存储权限
3. **功能不完整** - 登录功能必须可用
4. **设计不符合 HIG** - 需要遵循 Apple 人机界面指南
5. **WebView 应用** - 纯网页包装可能被拒
6. **API Key 暴露** - 不能在客户端硬编码敏感信息

### 技术改动清单

#### 1. 添加 iOS 平台

```bash
cd mobile
npx cap add ios
```

会生成 `mobile/ios/` 目录。

#### 2. 原生配置文件

| 配置项   | Android               | iOS                       |
| -------- | --------------------- | ------------------------- |
| 应用名   | `strings.xml`         | `Info.plist`              |
| 图标     | `res/mipmap-*`        | `Assets.xcassets`         |
| 启动画面 | `SplashScreen`        | `LaunchScreen.storyboard` |
| 权限     | `AndroidManifest.xml` | `Info.plist`              |

#### 3. 代码调整

```typescript
// 平台检测
import { Capacitor } from "@capacitor/core";
const isIOS = Capacitor.getPlatform() === "ios";
const isAndroid = Capacitor.getPlatform() === "android";

// 文件路径差异
// Android: Directory.Documents → /data/data/app/files/
// iOS: Directory.Documents → ~/Documents/ (会同步到 iCloud)
// iOS 某些场景需要用 Directory.Library
```

#### 4. CI/CD 更新

```yaml
# .github/workflows/mobile.yml 需要添加
build-ios:
  runs-on: macos-latest
  steps:
    - name: Setup Xcode
      uses: maxim-lobanov/setup-xcode@v1
    - name: Build iOS
      run: |
        cd mobile/ios/App
        xcodebuild -workspace App.xcworkspace -scheme App -configuration Release
```

#### 5. 签名和证书

- **Apple Developer Account** ($99/年)
- **Distribution Certificate** - 发布证书
- **Provisioning Profile** - 配置文件
- 需要通过 Xcode 或 Fastlane 管理

### 本应用的特殊考虑

| 问题                | 说明                            |
| ------------------- | ------------------------------- |
| AI 生成内容         | 可能需要说明内容审核机制        |
| 外部支付 (API 余额) | 可能需要走 Apple IAP (30% 抽成) |
| 用户生成内容        | 可能需要举报机制                |
| WebGPU 支持         | Safari/WebKit 支持有限          |

### 建议

1. **优先级**：国内用户以 Android 为主，市场份额更大
2. **时机**：等 Android 版本稳定后再考虑 iOS
3. **资源**：需要准备年费、审核材料、可能的代码调整
4. **替代方案**：可以先做 PWA 支持，iOS 用户通过 Safari 添加到主屏幕

---

## 阶段性结论

### 为什么暂不支持 iOS

经过评估，决定**暂不开发 iOS 版本**，原因如下：

| 因素         | 说明                                                   |
| ------------ | ------------------------------------------------------ |
| **成本**     | Apple Developer 年费 $99，Android 一次性 $25           |
| **审核风险** | App Store 审核严格，AI 生成内容、外部支付可能被拒      |
| **开发周期** | 需要额外配置签名、证书、CI/CD，预计增加 1-2 周         |
| **用户覆盖** | 国内 Android 市场份额 >70%，优先覆盖主流用户           |
| **分发限制** | iOS 无法侧载，必须走 App Store；Android 可直接分发 APK |
| **技术风险** | WebGPU 在 iOS Safari 支持有限，部分 AI 功能可能受影响  |

**结论**：先把 Android 版本做稳定，积累用户反馈，再考虑 iOS。

---

## Android 分发方式（开源项目）

作为开源项目，分发方式很简单：

```
用户访问 GitHub Releases
       ↓
下载 APK 文件
       ↓
安装到手机（允许未知来源）
       ↓
使用
```

### 不需要的东西

| 项目             | 原因                           |
| ---------------- | ------------------------------ |
| Google Play 上架 | 开源项目直接 GitHub 下载即可   |
| 推送通知         | 用户 Watch 仓库即可收到更新    |
| 复杂的崩溃监控   | GitHub Issues 收集反馈足够     |
| 应用内更新       | 用户从 Releases 页面下载新版本 |

### 可选优化

| 项目             | 状态    | 说明                                   |
| ---------------- | ------- | -------------------------------------- |
| Release APK 签名 | ⏳ 可选 | 签名后安装体验更好，但 unsigned 也能用 |
| 性能优化         | ⏳ 持续 | 根据用户反馈优化                       |
| 翻译完善         | ⏳ 持续 | 社区可以贡献翻译                       |

### 已完成

- ✅ CI/CD 自动构建 APK
- ✅ GitHub Releases 自动发布
- ✅ 响应式布局（手机/平板）
- ✅ 深色模式
- ✅ 18 种语言支持
- ✅ 免费工具集成

---

## 发布流程

```bash
# 1. 确保代码在 mobile-app 分支
git checkout mobile-app

# 2. 合并最新 main（如需要）
git merge origin/main

# 3. 更新版本号
# - mobile/package.json
# - mobile/android/app/build.gradle

# 4. 提交并打标签
git add -A
git commit -m "chore: bump version to 0.8.x"
git tag mobile-v0.8.x
git push origin mobile-app --tags

# 5. CI 自动构建并发布到 GitHub Releases
```

用户下载：https://github.com/WaveSpeedAI/wavespeed-desktop/releases
