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
const platformService = getPlatformService()

// 存储
await platformService.getApiKey()
await platformService.setApiKey(key)
await platformService.getSettings()
await platformService.setSettings(settings)

// 文件
await platformService.saveAsset(url, type, fileName, subDir)
await platformService.deleteAsset(filePath)
await platformService.downloadFile(url, filename)

// 外部链接
await platformService.openExternal(url)

// 平台信息
platformService.getPlatform()  // 'capacitor' | 'web'
platformService.isMobile()
```

## 桌面端 vs 移动端功能差异

| 功能 | 桌面端 | 移动端 |
|------|--------|--------|
| Face Enhancer 模型 | 有 | 无（内存限制） |
| Background Remover | 有 | 有 |
| SAM 分割 | 有 | 有 |
| 批量生成 | 有 | 有 |
| 本地模型推理 | 有 | 有（ONNX Runtime Web） |

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
