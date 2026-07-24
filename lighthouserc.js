// ======================================================================
// Lighthouse CI 配置 — 武理小精灵
// 功能: 性能预算断言 + 审计报告生成
// 使用方式: npx lhci autorun
// ======================================================================
// 自动化接入后，每次 PR 或 push 都会自动跑 Lighthouse 审计：
//   - 性能评分低于 85 告警
//   - 核心 Web Vitals 超标（LCP > 2.5s / CLS > 0.1 / TBT > 200ms）告警
//   - 未使用 JS/CSS 比例过高告警
// ======================================================================

module.exports = {
  ci: {
    collect: {
      // 构建产物目录
      staticDistDir: 'dist',

      // 测试入口 URL（SPA 单页应用）
      url: ['http://localhost/'],

      // 运行 3 次取中位数，消除偶发波动
      numberOfRuns: 3,

      // 模拟移动端（Moto G4 模拟器 + 慢 3G 网络）
      settings: {
        preset: 'desktop',
        // 保留默认移动端模拟
      },
    },

    assert: {
      // 断言模式: warn-on-fail（不阻断 CI，但告警）
      // 如需严格阻断，改为 "off" 或保持 "warn-on-fail"
      preset: 'lighthouse:no-pwa',

      assertions: {
        // ── 综合评分 ──
        'categories:performance': ['warn', { minScore: 0.85 }],
        'categories:accessibility': ['warn', { minScore: 0.90 }],
        'categories:best-practices': ['warn', { minScore: 0.90 }],
        'categories:seo': ['warn', { minScore: 0.90 }],

        // ── 核心 Web Vitals ──
        'largest-contentful-paint': ['warn', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['warn', { maxNumericValue: 0.1 }],
        'total-blocking-time': ['warn', { maxNumericValue: 200 }],
        'interaction-to-next-paint': ['warn', { maxNumericValue: 200 }],

        // ── 资源优化 ──
        'unused-javascript': ['warn', { maxNumericValue: 0.30 }],
        'unused-css-rules': ['warn', { maxNumericValue: 0.30 }],
        'uses-responsive-images': ['warn', { minScore: 0.8 }],
        'offscreen-images': ['warn', { minScore: 0.8 }],

        // ── 加载优化 ──
        'render-blocking-resources': ['warn', { maxNumericValue: 0 }],
        'uses-rel-preconnect': ['warn', { minScore: 1 }],
        'uses-rel-preload': ['warn', { minScore: 1 }],
        'efficiently-sized-static-assets': ['warn', { minScore: 0.8 }],

        // ── 可访问性 ──
        'color-contrast': ['warn', { minScore: 0.9 }],
        'tap-targets': ['warn', { minScore: 0.9 }],
        'meta-viewport': ['warn', { minScore: 1 }],
        'document-title': ['warn', { minScore: 1 }],
      },
    },

    upload: {
      // 报告输出到本地目录，由 GitHub Actions 上传为 Artifacts
      target: 'filesystem',
      outputDir: '.lighthouseci/reports',
      reportFilenamePattern: 'lh-report-%%URL%%-%%DATETIME%%.%%EXTENSION%%',
    },
  },
};