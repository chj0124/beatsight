/* ESLint 配置（**本地自验专用，不进上站产物**）
   ---------------------------------------------------------------------------
   上站产物为 8 个对外文件：index.html / sw.js / manifest.webmanifest / icon.svg + 4 个 PNG 图标回退。
   本文件与 node_modules / package-lock.json 只存在于开发机，永远不会被发布；
   "运行时零依赖"这条硬约束针对的是 file:// 直开的产物，不是开发工具。

   与 tools/check-lint.js 的分工（重点，别当成重复建设）：
     · check-lint.js 是**零依赖**窄规则集，抓 no-var / eqeqeq / no-redeclare /
       no-unused-vars / no-undef 五条。它靠"正则 + 逐行剥注释 + 花括号作用域"实现，
       优点是不装任何东西就能跑、离线不飘，缺点是**看不见语法结构**——分不清
       "对象字面量的键"和"标签语句"，也做不了控制流分析。
     · 本配置补的正是它看不见的那部分：需要 AST / 作用域 / 控制流才能判的规则
       （死代码、重复键、switch 穿透、恒真条件、遮蔽、可选链误用……）。
   所以两者**刻意不重叠**——重叠的部分一律只由 check-lint.js 负责，这里全部关闭。

   为什么这里不按常规开 ESLint 的 no-undef（这是最容易照抄错的地方）：
     1) 重复报同一处问题只会让报告变长、定位变慢；
     2) ESLint 的 no-undef 需要一份完整且正确的宿主全局清单，而本仓库没装 `globals`
        包（只装了 eslint 本体）。手抄清单一旦漏项（例如漏了 webkitAudioContext、
        OffscreenCanvas），就会把**正确代码判红**。对自验闸门来说，"漏报"的代价远小于
        "误拦"——一个常年飘红的检查很快就会被所有人无视或直接关掉，等于没写。
       宿主全局的核对继续由 check-lint.js 的 GLOBALS 白名单负责。

   规则选取口径：只收**当前代码已全绿**的规则（实测 0 命中），这样闸门立起来就是干净的，
   将来只有真写错才变红。已知会命中现存代码、因而**故意不开**的三条（都属风格而非缺陷，
   且修它就得改 index.html 这个上站产物，得不偿失）：
     · prefer-const        —— index.html 有 2 处 let 未再赋值（onsetBuf / steps）
     · no-return-assign    —— 1 处箭头函数省略体直接返回赋值（forEach 里无害）
     · max-len / complexity 等风格与规模类规则，本项目另有排版约定，一律不收

   检查范围：**只有 index.html 的内联 <script>**。tools/ 与 tests/ 是开发脚本、
   不上线，实测有 5 处风格命中（no-regex-spaces / no-lone-blocks / no-shadow），
   故显式 ignore，避免 `npx eslint .` 时被它们刷屏。
   入口是 tools/check-eslint.js（它负责把内联脚本抽出来再交给 ESLint，并把行列号映射回
   index.html 的行号）。直接 `npx eslint <file>` 也能用同一套规则。

   版本：eslint 10.x（flat config）。本文件是 CommonJS——package.json 没有 "type": "module"。 */
"use strict";

module.exports = [
  {
    /* 显式圈定范围：产品代码 = index.html 内联脚本（由 check-eslint.js 喂进来），
       开发脚本与依赖树一律不查，理由见文件头 */
    ignores: ["node_modules/**", "tools/**", "tests/**", "hooks/**", ".trae-html-share-packages/**"],

    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",   // 内联脚本是经典脚本（无 import/export），顶层声明即脚本级作用域
      // globals 故意留空：no-undef 已关闭，宿主全局核对在 check-lint.js 做，见文件头
    },

    linterOptions: {
      reportUnusedDisableDirectives: "warn",   // 失效的 eslint-disable 注释要能被发现
    },

    rules: {
      /* ── 控制流 · 死代码（正则完全做不到，纯 AST 能力）──────────────────── */
      "no-unreachable": "error",                 // return/throw/break 之后的不可达语句
      "no-fallthrough": "error",                 // switch case 缺少 break 而穿透
      "no-dupe-else-if": "error",                // else-if 条件重复，后面的分支永远进不去
      "no-constant-condition": "error",          // if(true) / 常量条件
      "no-cond-assign": "error",                 // if (x = y)：想写 == 却写成 = 的头号事故
      "no-unsafe-negation": "error",             // !key in obj：优先级陷阱
      "no-self-compare": "error",                // x === x，恒真
      "no-constant-binary-expression": "error",  // 两个常量做运算，结果恒定
      "use-isnan": "error",                      // 用 === NaN 判 NaN（永远 false）
      "valid-typeof": "error",                   // typeof x === "strnig" 拼错
      "no-compare-neg-zero": "error",            // x === -0
      "no-sequences": "error",                   // 逗号表达式当作一条语句，易漏副作用

      /* ── 字面量 / 语法结构（需要真解析器才分得清"键"和"标签"）────────────── */
      "no-dupe-keys": "error",                   // 对象字面量重复键（后者覆盖前者，静默丢配置）
      "no-dupe-args": "error",                   // 函数重复形参（严格模式下直接语法错误）
      "no-duplicate-case": "error",              // switch 重复 case
      "no-sparse-arrays": "error",               // [1,,3] 空洞数组
      "no-obj-calls": "error",                   // 把 Math / JSON 当函数调用
      "no-loss-of-precision": "error",           // 数字字面量精度丢失
      "no-template-curly-in-string": "error",    // 普通引号串里写了 ${x}（忘了用反引号）
      "no-extra-boolean-cast": "error",          // if (!!x) 这类多余强转
      "no-empty-character-class": "error",       // 正则里 [] 空字符类，永远匹配不上
      "no-empty-pattern": "error",               // 解构 {} = obj
      "no-invalid-regexp": "error",              // new RegExp 非法模式
      "no-control-regex": "error",               // 正则里混入不可见控制字符
      "no-unexpected-multiline": "error",        // 断行导致的意外语义（ASI 陷阱）
      "no-unsafe-optional-chaining": "error",    // (a?.b).c：a 为 null 时会抛

      /* ── 空块 / 冗余 ─────────────────────────────────────────────────── */
      "no-empty": ["error", { allowEmptyCatch: true }],  // 空块；但 catch(e){} 是本项目刻意的静默降级，放行
      "no-unused-private-class-members": "error",
      "no-irregular-whitespace": "error",        // 全角空格等不可见空白混进代码
      "no-useless-return": "error",
      "no-useless-rename": "error",              // {a: a} 之类的无效重命名
      "no-unused-labels": "error",
      "no-lone-blocks": "error",                 // 没有语义的孤立 {} 块
      "no-extra-semi": "error",
      "no-self-assign": "error",                 // x = x
      "no-useless-call": "error",                // f.call(null, ...) 可直接调用
      "no-useless-concat": "error",              // "a" + "b" 拆成两个字面量
      "no-useless-escape": "error",              // 多余的转义反斜杠
      "no-regex-spaces": "error",                // 正则里连写空格（该用 {2}）

      /* ── 明显的坑（写出来几乎一定是手滑）──────────────────────────────── */
      "no-debugger": "error",                    // 忘了删的 debugger，会真的中断执行
      "no-eval": "error",
      "no-implied-eval": "error",                // setTimeout("代码串")
      "no-script-url": "error",
      "no-proto": "error",                       // 用 __proto__
      "no-iterator": "error",                    // 用 __iterator__
      "no-caller": "error",                      // 用 arguments.caller/callee
      "no-extend-native": "error",               // 改原型链上的内建对象
      "no-global-assign": "error",               // 给内建全局赋值
      "no-new-wrappers": "error",                // new String()/Number()/Boolean()
      "no-array-constructor": "error",           // new Array(1,2) 的歧义
      "no-new-object": "error",
      "no-throw-literal": "error",               // throw "字符串"（抛出的不是 Error）
      "no-ex-assign": "error",                   // 覆盖 catch 的异常变量
      "no-func-assign": "error",                 // 给函数名重新赋值
      "no-delete-var": "error",                  // delete 普通变量
      "no-void": "error",
      "no-multi-str": "error",                   // 反斜杠续行的多行字符串
      "no-unmodified-loop-condition": "error",   // 循环条件里的变量在体内没被改，多半是死循环
      "no-prototype-builtins": "error",          // obj.hasOwnProperty(...) 应走 Object.prototype
      "no-await-in-loop": "error",               // 循环里串行 await，通常是漏了 Promise.all
      "array-callback-return": "error",          // map/filter 回调漏写 return，静默产出 undefined

      /* ── 作用域（比正则的"同名重复声明"更进一步，能看出嵌套遮蔽）───────── */
      /* allow: ["D"] —— 顶层有个 tick 工具函数 const D = (t, rest) => ({t, rest})，
         Audio 模块内部 2 处用 D 当"鼓组音色参数表"的局部别名，属刻意命名。
         改这两处就得动 index.html（上站产物）→ 为一个纯风格问题不值得，
         故对 D 这一个名字放行；其余任何名字的遮蔽照拦。 */
      "no-shadow": ["error", { allow: ["D"] }],
    },
  },
];
