/**
 * Client half of 不忘 (Buwang).
 *
 * The panel reads the library through one RPC channel ('/buwang'), renders
 * four sections, and writes settings back through the same channel. It keeps
 * no copy of the data: the files on disk are the truth, this is a view.
 *
 * Compatibility notes:
 *   - public slot names and `--dsw-alias-*` theme tokens only
 *   - no Harness Client package is imported; controls are drawn here
 *   - every host call goes through `call()`, one place to adapt
 *   - a failed call renders a visible error instead of an empty panel
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-buwang',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;
    const useRef = React.useRef;

    const DICT = {
      title: '不忘',
      subtitle: '主动记录的日记与过往，我不会忘记',
      gear: '设置',
      close: '关闭',
      loading: '正在翻开记忆库…',
      retry: '再试一次',
      emptyMemory: '这一页还是空的',
      emptyPersona: '还没有谁住进来',
      emptyWorkshop: '工坊里还空着',
      emptySealed: '封存里很安静',
      emptyPersonaHint: '点上面「＋ 新建人格」，写下一个人',
      emptyMemoryHint: '说一句「记住这个」，或者让我把今天留在这儿',
      emptyWorkshopHint: '点上面「＋ 写一个技能」，把常用的做法存成一条',
      emptySealedHint: '删掉的人、封存的字，都会沉在这儿；想起来了，随时接回去',
      recent: '短期 · 最近的日子',
      archive: '长期 · 只剩一句，细节要翻',
      aboutMe: '同游 · 每轮都在',
      tidyTongyou: '整理同游',
      tidyTip: '同游会越写越长。点一下先看要搬走哪几条，确认后才搬去长期（留最近 20 条）',
      tidyAsk: '将搬走最早 {move} 条（共 {total} 条，留下最近 {keep} 条）。\n原文一字不改，会进长期，需要时照样搜得到。',
      tidyNothing: '同游现在 {n} 条，还没到需要搬的程度。',
      consolidateLabel: '巩固…',
      consolidateTip: '巩固要我来写那段小结，所以入口在输入框。点一下把这句复制走，粘进去发给我',
      consolidateCopied: '已经复制好了。粘到输入框发给我，我先列候选给你看，你点头才动。',
      consolidateManual: '复制没成功，你手动把这句发给我：',
      active: '启用中',
      dormant: '休眠',
      newPersona: '新建人格',
      newWorkshop: '写一个技能',
      enableNow: '保存后直接启用（正文每轮都在）',
      enableNowHint: '不勾就先收进「未启用」，只留一个名字；要用的时候再点开',
      activate: '启用',
      activateTip: '启用这一个；正在启用的那位会自己睡下',
      deleteLabel: '删除',
      deleteTip: '连人带记忆整盒搬进封存，随时能找回来；醒着的那位不能删',
      shareLabel: '可读别人格的记忆（只读）',
      shareHint: '默认不共享。勾上之后，这一位能翻那一位的记忆，但碰不了那边的东西。',
      alwaysOn: '启用中',
      alwaysOff: '未启用',
      modeOnTip: '启用中：正文每轮都在。点一下收起来',
      modeOffTip: '未启用：只在目录里留个名字。点一下让它现身',
      sealLabel: '封存这条',
      sealTip: '不索引、不检索、不注入，字还在。想起来了再恢复',
      restoreLabel: '恢复',
      sealedPersonaGroup: '整个角色',
      sealedDocGroup: '封存的文档',
      restorePersonaLabel: '接回来',
      restorePersonaTip: '人格、记忆、工坊一起搬回原位；重名会挡下来',
      personaBadge: '角色',
      folderLabel: '文件夹',
      folderBoxTip: '在上一级打开它所在的文件夹。要真删就在那儿删——不忘只负责记得',
      folderDocTip: '在上一级打它所在的封存目录',
      injectHints: {
        core: '人格全文每轮都在——只有「启用中」的那一位，其余睡下，不占地方',
        persona: '人格条目：标成常驻才每轮都在，按需的只留一张名片',
        about: '同游：我们之间的事，每轮全文都在；过时的条目搬去长期',
        memory: '正文不会每轮都在，需要时按日期或关键词翻出来',
        workshop: '工坊：默认收着，只留名字；点成「启用中」才会每轮现身',
        sealed: '封存的东西不会被想起',
      },
      editor: {
        heading: '写点什么',
        titleLabel: '标题',
        summaryLabel: '一句话',
        summaryHint: '这句话会挂在每轮都能看到的索引上，越短越好',
        bodyLabel: '正文',
        titlePlaceholder: '给它起个名字',
        summaryPlaceholder: '一句话，够我认出它',
        save: '保存',
        saving: '存着…',
        cancel: '取消',
        failed: '没存上，再试一次',
        titleRequired: '先起个名字',
        selfNavPrev: '更早',
        selfNavNext: '更晚',
        selfNavPrevTip: '翻到更早写的那一页',
        selfNavNextTip: '翻到更晚写的那一页',
        selfNavDirty: '这一页改了还没保存，翻走就不见了。继续翻？',
      },
      settings: {
        heading: '设置',
        nameLabel: '你的名字',
        nameHint: '（人格没单独给你起称呼时，就用这个名字叫你）',
        budgetLabel: '常驻预算',
        budgetOptions: [
          { id: 'small', label: '省', value: '800' },
          { id: 'normal', label: '标准', value: '2000' },
          { id: 'large', label: '宽松', value: '4000' },
        ],
        consolidateLabel: '巩固提醒',
        recentDaysLabel: '索引看几天',
        recentDaysOptions: [3, 5, 7],
        keepDaysLabel: '巩固留几天',
        keepDaysOptions: [2, 3],
        dataLabel: '数据位置（记忆库文件夹）',
        dataHint: '记忆库就是一个普通文件夹，你想放哪儿都行；换完重载一次就生效',
        openLabel: '打开文件夹',
        openItems: ['人格', '记忆', '工坊', '封存'],
        pickRoot: '换位置…',
        openRoot: '打开',
        resetRoot: '用回默认',
        backupLabel: '备份一份',
        backupTip: '把整个库复制到隔壁文件夹，名字带时间；旧备份不删也不覆盖',
        backupDone: '备份好了\n{path}\n{files} 个文件，{size}',
        backupFailed: '备份没成：',
        rootPending: '准备切换到：',
        rootMove: '连文件一起搬',
        rootPoint: '只改指向',
        rootCancel: '算了',
        rootMoving: '正在搬，别关窗口…',
        rootDone: '已搬好 · 重载插件后生效',
        rootResetDone: '已改回默认位置 · 重载插件后生效',
        saved: '已记住',
        failed: '没存上，再试一次',
      },
      tabs: [
        {
          id: 'persona',
          label: '人格',
          body: '可以有很多个自己，同一时间只有一个醒着。醒着的那个每轮都在场，一字不落；其余的睡在文件里，等你想起来。',
          empty: 'emptyPersona',
        },
        {
          id: 'memory',
          label: '记忆',
          body: '同游是常伴的那一页，每轮都在。近期是这几天的事，一天一页，只留一行题；长期被时间揉过，只剩一句，想细看再翻。',
          empty: 'emptyMemory',
        },
        {
          id: 'workshop',
          label: '工坊',
          body: '默认收着，只在目录里留个名字。哪天用得着，说一声，我把它们摊开给你挑；挑中的才现身，用完就收起来。',
          empty: 'emptyWorkshop',
        },
        {
          id: 'sealed',
          label: '封存',
          body: '不索引、不检索、不注入，也不会被我主动提起。删掉的人整盒沉在这儿，想起来了，随时接回去。',
          empty: 'emptySealed',
        },
      ],
      quick: {
        label: '不忘',
        title: '不忘 · 快捷',
        hint: '点一下，替你把这句话起个头',
        items: [
          {
            id: 'today',
            text: '总结今天',
            desc: '存一条记忆，再写一页自述',
            draft: '【总结一下今天】整理成一条记忆存进不忘，再写一条自述（这一小时写过就跳过）',
          },
          {
            id: 'learn',
            text: '今天学的进工坊',
            desc: '给这门手艺起个名字收起来',
            draft: '【把今天学的存进工坊：】',
          },
          {
            id: 'skills',
            text: '搜工坊技能',
            desc: '按关键词摊开一条技能',
            draft: '【搜一下工坊里的技能：】',
          },
          {
            id: 'consolidate',
            text: '巩固记忆',
            desc: '旧的短期压成长期，先看候选',
            draft: '【巩固一下不忘的记忆】先给我看候选，别直接动',
          },
          {
            id: 'remember',
            text: '记住这个',
            desc: '定数 / 今天的事 / 手艺，自动分',
            draft: '【记住这个：】',
          },
          {
            id: 'recall',
            text: '翻记忆',
            desc: '按日期或关键词翻正文',
            draft: '【翻一下不忘里的记忆：】',
          },
          {
            id: 'open',
            text: '打开不忘',
            desc: '看整个库、换设置',
          },
        ],
      },
    };

    const S = {
      root: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        position: 'relative',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
      },
      header: { display: 'flex', alignItems: 'center', gap: '12px', padding: '20px 24px 12px' },
      titleWrap: { display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0 },
      title: { fontSize: '18px', fontWeight: 600, lineHeight: 1.3 },
      subtitle: {
        fontSize: '12px',
        color: 'var(--dsw-alias-label-secondary)',
        lineHeight: 1.4,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      iconBtn: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '32px',
        height: '32px',
        borderRadius: '8px',
        border: '1px solid transparent',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
        flex: '0 0 auto',
      },
      tabs: {
        display: 'flex',
        gap: '4px',
        padding: '0 24px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
      },
      tab: {
        position: 'relative',
        padding: '8px 12px 10px',
        fontSize: '13px',
        fontWeight: 500,
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
        font: 'inherit',
      },
      tabActive: {
        color: 'var(--dsw-alias-label-primary)',
      },
      body: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 24px 32px' },
      sectionBody: {
        fontSize: '12.5px',
        lineHeight: 1.75,
        color: 'var(--dsw-alias-label-secondary)',
        marginBottom: '14px',
      },
      groupTitle: {
        display: 'flex',
        alignItems: 'baseline',
        gap: '8px',
        fontSize: '12px',
        fontWeight: 600,
        color: 'var(--dsw-alias-label-secondary)',
        margin: '18px 0 8px',
        letterSpacing: '0.02em',
      },
      count: { fontWeight: 400, color: 'var(--dsw-alias-label-tertiary)' },
      list: { display: 'flex', flexDirection: 'column', gap: '6px' },
      row: {
        display: 'flex',
        flexDirection: 'column',
        gap: '3px',
        padding: '10px 12px',
        borderRadius: '9px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      rowHead: { display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: 0 },
      rowTitle: {
        fontSize: '13px',
        fontWeight: 500,
        color: 'var(--dsw-alias-label-primary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        flex: 1,
        minWidth: 0,
      },
      rowDate: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', flex: '0 0 auto' },
      rowSummary: { fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' },
      badge: {
        fontSize: '10px',
        lineHeight: '16px',
        padding: '0 6px',
        borderRadius: '4px',
        border: '1px solid var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-tertiary)',
        flex: '0 0 auto',
      },
      empty: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        padding: '32px 20px',
        borderRadius: '12px',
        border: '1px dashed var(--dsw-alias-border-l2)',
        background: 'transparent',
        textAlign: 'center',
      },
      emptyGlyph: { color: 'var(--dsw-alias-label-tertiary)', opacity: 0.55, marginBottom: '2px' },
      emptyTitle: { fontSize: '13px', fontWeight: 500, color: 'var(--dsw-alias-label-secondary)' },
      emptyHint: {
        fontSize: '11.5px',
        lineHeight: 1.6,
        color: 'var(--dsw-alias-label-tertiary)',
        maxWidth: '34ch',
      },
      checkRow: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '8px',
        cursor: 'pointer',
      },
      checkLabel: { fontSize: '13px', color: 'var(--dsw-alias-label-primary)' },
      error: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '16px',
        borderRadius: '10px',
        border: '1px solid var(--dsw-alias-state-error-primary)',
        background: 'var(--dsw-alias-bg-layer-1)',
        fontSize: '12px',
        lineHeight: 1.7,
        color: 'var(--dsw-alias-label-secondary)',
        wordBreak: 'break-all',
      },
      drawer: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: '340px',
        maxWidth: '86%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--dsw-alias-bg-base)',
        borderLeft: '1px solid var(--dsw-alias-border-l1)',
        boxShadow: '-8px 0 24px rgba(0,0,0,0.18)',
        zIndex: 2,
      },
      drawerHead: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '16px 18px 12px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
      },
      drawerTitle: { flex: 1, fontSize: '14px', fontWeight: 600 },
      // 自述页的左右翻页条：左=更早、右=更晚，按钮上写着那一页的日期与时刻
      selfNav: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 18px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
      },
      selfNavPos: {
        flex: 1,
        textAlign: 'center',
        fontSize: '11.5px',
        color: 'var(--dsw-alias-label-tertiary)',
      },
      drawerBody: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 18px 24px' },
      field: { marginBottom: '20px' },
      fieldLabel: {
        display: 'block',
        fontSize: '12px',
        fontWeight: 500,
        color: 'var(--dsw-alias-label-primary)',
        marginBottom: '6px',
      },
      fieldHint: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '5px', lineHeight: 1.5 },
      bodyHint: {
        fontSize: '11px',
        color: 'var(--dsw-alias-label-tertiary)',
        margin: '0 0 6px',
        lineHeight: 1.5,
      },
      input: {
        font: 'inherit',
        width: '100%',
        boxSizing: 'border-box',
        padding: '7px 10px',
        fontSize: '13px',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '7px',
      },
      segmented: { display: 'flex', gap: '6px' },
      segment: {
        font: 'inherit',
        flex: 1,
        padding: '7px 0',
        fontSize: '12px',
        textAlign: 'center',
        borderRadius: '7px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
      },
      segmentActive: {
        borderColor: 'var(--dsw-alias-brand-primary)',
        color: 'var(--dsw-alias-label-primary)',
        boxShadow: 'inset 0 0 0 1px var(--dsw-alias-brand-primary)',
      },
      value: {
        fontSize: '12px',
        color: 'var(--dsw-alias-label-secondary)',
        lineHeight: 1.6,
        padding: '7px 10px',
        borderRadius: '7px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        wordBreak: 'break-all',
      },
      grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' },
      tabBar: { display: 'flex', justifyContent: 'flex-end', margin: '2px 0 8px' },
      rowActions: { display: 'inline-flex', gap: '4px', flex: '0 0 auto' },
      chips: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' },
      editor: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--dsw-alias-bg-base)',
        zIndex: 3,
      },
      editorBody: {
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 18px 8px',
        overflowY: 'auto',
      },
      fieldGrow: {
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: '180px',
        marginBottom: '12px',
      },
      textarea: {
        font: 'inherit',
        flex: 1,
        minHeight: '180px',
        width: '100%',
        boxSizing: 'border-box',
        padding: '9px 10px',
        fontSize: '13px',
        lineHeight: 1.7,
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '7px',
        resize: 'vertical',
        whiteSpace: 'pre-wrap',
      },
      editorFoot: {
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: '8px',
        padding: '10px 18px 16px',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      primaryBtn: {
        font: 'inherit',
        padding: '7px 16px',
        fontSize: '12px',
        fontWeight: 500,
        color: '#ffffff',
        background: '#2b7fd4',
        border: '1px solid #2b7fd4',
        borderRadius: '7px',
        cursor: 'pointer',
        transition: 'background .15s ease, opacity .15s ease',
      },
      ghostBtn: {
        font: 'inherit',
        padding: '7px 10px',
        fontSize: '12px',
        borderRadius: '7px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
      },
      divider: { height: '1px', background: 'var(--dsw-alias-border-l1)', margin: '4px 0 18px' },
    };

    // Component-local styles for hover/active states, which inline style
    // objects cannot express. Only theme tokens are referenced.
    const CSS = `
      .bw-gear {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 32px;
        padding: 0 12px;
        border-radius: 9px;
        border: 1px solid var(--dsw-alias-border-l2);
        background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 13px;
        line-height: 1;
        cursor: pointer;
        transition: background .15s ease, border-color .15s ease, color .15s ease;
      }
      .bw-gear:hover {
        background: var(--dsw-alias-bg-layer-2);
        border-color: var(--dsw-alias-brand-primary);
      }
      .bw-gear:active { transform: translateY(1px); }
      .bw-gear:focus-visible {
        outline: 2px solid var(--dsw-alias-brand-primary);
        outline-offset: 2px;
      }
      .bw-gear[data-open="true"] {
        border-color: var(--dsw-alias-brand-primary);
        color: var(--dsw-alias-brand-primary);
      }
      .bw-ghost {
        transition: background .15s ease, border-color .15s ease;
      }
      .bw-ghost:hover {
        background: var(--dsw-alias-bg-layer-2);
        border-color: var(--dsw-alias-border-l2);
      }
      .bw-ghost:active { transform: translateY(1px); }
      .bw-ghost:disabled {
        opacity: 0.45;
        cursor: default;
        transform: none;
      }
      .bw-ghost:focus-visible {
        outline: 2px solid var(--dsw-alias-brand-primary);
        outline-offset: 2px;
      }
      .bw-row-editable {
        cursor: pointer;
      }
      .bw-row-editable:hover {
        border-color: var(--dsw-alias-border-l2) !important;
        background: var(--dsw-alias-bg-layer-2) !important;
      }
      .bw-row-editable:focus-visible {
        outline: 2px solid var(--dsw-alias-brand-primary);
        outline-offset: 2px;
      }
      .bw-mode {
        flex: 0 0 auto;
        font-size: 10px;
        line-height: 16px;
        padding: 0 6px;
        border-radius: 4px;
        border: 1px solid var(--dsw-alias-border-l1);
        background: transparent;
        color: var(--dsw-alias-label-tertiary);
        cursor: pointer;
        transition: color .15s ease, border-color .15s ease, background .15s ease;
      }
      .bw-mode:hover {
        color: var(--dsw-alias-label-primary);
        border-color: var(--dsw-alias-border-l2);
        background: var(--dsw-alias-bg-layer-2);
      }
      .bw-mode[data-on="true"] {
        color: var(--dsw-alias-brand-primary);
        border-color: var(--dsw-alias-brand-primary);
      }
      .bw-mode:active { transform: translateY(1px); }
      .bw-mode:focus-visible {
        outline: 2px solid var(--dsw-alias-brand-primary);
        outline-offset: 2px;
      }
      .bw-primary:hover { opacity: 0.88; }
      .bw-primary:active { transform: translateY(1px); }
      .bw-primary:disabled { opacity: 0.6; cursor: default; }
      .bw-primary:focus-visible {
        outline: 2px solid var(--dsw-alias-brand-primary);
        outline-offset: 2px;
      }
      .bw-quick {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 8px;
        border: 1px solid transparent;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
        transition: background .15s ease, color .15s ease;
      }
      .bw-quick:hover {
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
      }
      .bw-quick[data-open="true"] {
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-brand-primary);
      }
      .bw-quick:focus-visible {
        outline: 2px solid var(--dsw-alias-brand-primary);
        outline-offset: 2px;
      }
      .bw-menu {
        position: absolute;
        bottom: 38px;
        left: 0;
        min-width: 168px;
        padding: 6px;
        border-radius: 10px;
        border: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-base);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
        z-index: 30;
      }
      .bw-menu-item {
        display: block;
        width: 100%;
        padding: 7px 10px;
        border: none;
        border-radius: 7px;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 12.5px;
        text-align: left;
        cursor: pointer;
        white-space: nowrap;
      }
      .bw-menu-item:hover {
        background: var(--dsw-alias-bg-layer-2);
      }
      .bw-menu-sep {
        height: 1px;
        margin: 5px 6px;
        background: var(--dsw-alias-border-l1);
      }
      @keyframes bw-menu-in {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: none; }
      }
      @keyframes bw-fade-in {
        from { opacity: 0; transform: translateY(2px); }
        to { opacity: 1; transform: none; }
      }
      .bw-body {
        scrollbar-width: thin;
        scrollbar-color: var(--dsw-alias-border-l2) transparent;
      }
      .bw-body::-webkit-scrollbar { width: 8px; }
      .bw-body::-webkit-scrollbar-track { background: transparent; }
      .bw-body::-webkit-scrollbar-thumb {
        background: var(--dsw-alias-border-l2);
        border-radius: 999px;
      }
      .bw-body::-webkit-scrollbar-thumb:hover {
        background: var(--dsw-alias-label-tertiary);
      }
      .bw-tab {
        position: relative;
        transition: color .16s ease;
      }
      .bw-tab::after {
        content: "";
        position: absolute;
        left: 12px;
        right: 12px;
        bottom: 0;
        height: 2px;
        border-radius: 2px 2px 0 0;
        background: var(--dsw-alias-brand-primary);
        transform: scaleX(0);
        transform-origin: center;
        transition: transform .18s ease;
      }
      .bw-tab[data-active="true"]::after { transform: scaleX(1); }
      .bw-tab:hover { color: var(--dsw-alias-label-primary); }
      .bw-tab:focus-visible {
        outline: 2px solid var(--dsw-alias-brand-primary);
        outline-offset: -2px;
        border-radius: 6px;
      }
      .bw-row {
        transition: background .15s ease, border-color .15s ease, box-shadow .15s ease;
      }
      .bw-row:hover {
        border-color: var(--dsw-alias-border-l2);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
      }
      .bw-group { animation: bw-fade-in .18s ease; }
      .bw-empty {
        animation: bw-fade-in .2s ease;
      }
      .bw-mode {
        border-radius: 999px;
      }
      .bw-mode[data-on="true"] {
        background: var(--dsw-alias-bg-layer-2);
      }
      .bw-divider {
        height: 1px;
        background: var(--dsw-alias-border-l1);
        margin: 18px 0;
      }
      .bw-hint {
        font-size: 11.5px;
        line-height: 1.6;
        color: var(--dsw-alias-label-tertiary);
      }
      .bw-input,
      .bw-textarea {
        transition: border-color .15s ease, background .15s ease;
      }      .bw-input:hover,
      .bw-textarea:hover {
        border-color: var(--dsw-alias-border-l2);
      }
      .bw-input:focus,
      .bw-textarea:focus {
        border-color: var(--dsw-alias-brand-primary);
      }
      .bw-input:focus-visible,
      .bw-textarea:focus-visible {
        outline: 2px solid var(--dsw-alias-brand-primary);
        outline-offset: 1px;
      }
    `;

    /* ---------------------------------------------------------------- */
    /* Icons                                                             */
    /* ---------------------------------------------------------------- */

    function GearGlyph(props) {
      const size = props.size || 16;
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        [
          h('circle', { key: 'c', cx: 12, cy: 12, r: 3 }),
          h('path', {
            key: 'p',
            d: 'M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z',
          }),
        ]
      );
    }

    function CloseGlyph(props) {
      const size = props.size || 16;
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          'aria-hidden': true,
        },
        [h('path', { key: 'x', d: 'M6 6l12 12M18 6L6 18' })]
      );
    }

    function BuwangIcon(props) {
      const size = (props && props.size) || 20;
      const active = !!(props && props.active);
      const fg = active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)';
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        [
          h('path', {
            key: 'book',
            d: 'M5.5 4.5h9a3 3 0 0 1 3 3v12h-9a3 3 0 0 1-3-3z',
            stroke: fg,
            strokeWidth: 1.6,
            strokeLinejoin: 'round',
          }),
          h('path', { key: 'spine', d: 'M8.5 4.5v15', stroke: fg, strokeWidth: 1.6, strokeLinecap: 'round' }),
          h('path', {
            key: 'lines',
            d: 'M11 9h4M11 12.5h4M11 16h2.5',
            stroke: fg,
            strokeWidth: 1.4,
            strokeLinecap: 'round',
            opacity: 0.8,
          }),
        ]
      );
    }

    /* ---------------------------------------------------------------- */
    /* Composer quick menu                                               */
    /* ---------------------------------------------------------------- */

    function QuickButton(props) {
      const [open, setOpen] = useState(false);
      const wrapRef = useRef(null);

      useEffect(() => {
        if (!open) return undefined;
        const onDown = (event) => {
          if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
        };
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('mousedown', onDown);
          document.removeEventListener('keydown', onKey);
        };
      }, [open]);

      const writeDraft = (text) => {
        const actions = props.inputActions;
        try {
          if (actions && typeof actions.insertText === 'function' && typeof actions.captureInsertion === 'function') {
            const span = actions.captureInsertion();
            if (actions.insertText(text, span)) return;
          }
          if (actions && typeof actions.setDraft === 'function') actions.setDraft(text);
        } catch (err) {
          // a locked editor keeps its draft; the user can still type
        }
      };

      const pick = (item) => {
        setOpen(false);
        if (item.id === 'open') {
          props.openPanel();
          return;
        }
        writeDraft(item.draft);
      };

      // Menu chrome is inline, not class-only: this slot renders in the composer,
      // where the panel's <style> tag may not be mounted yet. Without that, the
      // items laid out in a row across the whole input bar.
      const menuBox = {
        position: 'absolute',
        bottom: '34px',
        left: '0',
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        minWidth: '236px',
        padding: '6px',
        borderRadius: '12px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
        boxShadow: '0 10px 28px rgba(0, 0, 0, 0.24)',
        animation: 'bw-menu-in .14s ease',
      };
      const menuItem = {
        display: 'block',
        width: '100%',
        boxSizing: 'border-box',
        padding: '7px 10px',
        border: 'none',
        borderRadius: '7px',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontSize: '12.5px',
        textAlign: 'left',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
      };

      const rows = [];
      if (DICT.quick.hint) {
        rows.push(
          h(
            'div',
            {
              key: 'hint',
              style: {
                padding: '3px 10px 6px',
                fontSize: '11px',
                color: 'var(--dsw-alias-label-primary)',
                opacity: 0.55,
                whiteSpace: 'nowrap',
              },
            },
            DICT.quick.hint
          )
        );
      }
      for (const item of DICT.quick.items) {
        if (item.id === 'open') {
          rows.push(
            h('div', {
              key: 'sep',
              style: { height: '1px', margin: '5px 6px', background: 'var(--dsw-alias-border-l1)' },
            })
          );
        }
        rows.push(
          h(
            'button',
            {
              key: item.id,
              type: 'button',
              role: 'menuitem',
              className: 'bw-menu-item',
              style: menuItem,
              title: item.desc || '',
              onClick: () => pick(item),
            },
            [
              h('span', { key: 'l', style: { display: 'block' } }, item.text),
              item.desc
                ? h(
                    'span',
                    {
                      key: 'd',
                      style: {
                        display: 'block',
                        marginTop: '1px',
                        fontSize: '11px',
                        color: 'var(--dsw-alias-label-primary)',
                        opacity: 0.5,
                      },
                    },
                    item.desc
                  )
                : null,
            ]
          )
        );
      }

      return h(
        'span',
        { ref: wrapRef, style: { position: 'relative', display: 'inline-flex', alignItems: 'center' } },
        [
          h('style', { key: 'css' }, CSS),
          h(
            'button',
            {
              key: 'btn',
              type: 'button',
              className: 'bw-quick',
              title: DICT.quick.title,
              'aria-label': DICT.quick.title,
              'aria-haspopup': 'menu',
              'aria-expanded': open,
              'data-open': open ? 'true' : 'false',
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '28px',
                height: '28px',
                padding: 0,
                borderRadius: '8px',
                border: '1px solid transparent',
                background: open ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
                color: open ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
                cursor: 'pointer',
              },
              onClick: () => setOpen((v) => !v),
            },
            h(BuwangIcon, { size: 16, active: open })
          ),
          open
            ? h('div', { key: 'menu', className: 'bw-menu', role: 'menu', style: menuBox }, rows)
            : null,
        ]
      );
    }

    /* ---------------------------------------------------------------- */
    /* Pieces                                                            */
    /* ---------------------------------------------------------------- */

    function Row(props) {
      const doc = props.doc;
      const editable = typeof props.onEdit === 'function';
      return h(
        'div',
        {
          className: editable ? 'bw-row bw-row-editable' : 'bw-row',
          style: S.row,
          onClick: editable ? () => props.onEdit(doc) : undefined,
        },
        [
          h('div', { key: 'h', style: S.rowHead }, [
            h('span', { key: 't', style: S.rowTitle }, doc.title),
            props.badge ? h('span', { key: 'b', style: S.badge }, props.badge) : null,
            doc.date
              ? h(
                  'span',
                  { key: 'd', style: S.rowDate },
                  // 同一天可能有好几页，日期旁边带上时刻才分得清先后
                  doc.logged ? doc.date + ' ' + doc.logged : doc.date
                )
              : null,
            props.action || null,
          ]),
          doc.summary && !props.plain ? h('div', { key: 's', style: S.rowSummary }, doc.summary) : null,
        ]
      );
    }

    function Group(props) {
      if (!props.docs || props.docs.length === 0) return null;
      return h('div', { className: 'bw-group' }, [
        h('div', { key: 't', style: S.groupTitle }, [
          h('span', { key: 'n' }, props.title),
          h('span', { key: 'c', style: S.count }, String(props.docs.length)),
        ]),
        h(
          'div',
          { key: 'l', style: S.list },
          props.docs.map((doc, i) =>
            h(Row, {
              key: doc.path || String(i),
              doc,
              badge: props.badgeOf ? props.badgeOf(doc) : '',
              action: props.actionOf ? props.actionOf(doc) : null,
              plain: props.plain,
              onEdit: props.onEdit,
            })
          )
        ),
      ]);
    }

    function Empty(props) {
      return h('div', { className: 'bw-empty', style: S.empty }, [
        h('div', { key: 'g', style: S.emptyGlyph }, h(BuwangIcon, { size: 22 })),
        h('div', { key: 't', style: S.emptyTitle }, props.text),
        props.hint ? h('div', { key: 'h', style: S.emptyHint }, props.hint) : null,
      ]);
    }

    function TabBody(props) {
      const d = props.data;
      const tab = props.tab;

      if (tab.id === 'persona') {
        const personas = d.personas || [];
        const activeFile = '人格/' + (d.activePersona || '') + '.md';
        const actionOf = (doc) => {
          if (doc.path === activeFile) return null;
          return h('span', { key: 'a', style: S.rowActions }, [
            h(
              'button',
              {
                key: 'on',
                type: 'button',
                className: 'bw-mode',
                title: DICT.activateTip,
                onClick: (event) => {
                  if (event && event.stopPropagation) event.stopPropagation();
                  if (props.activatePersona) props.activatePersona(doc);
                },
              },
              DICT.activate
            ),
            h(
              'button',
              {
                key: 'del',
                type: 'button',
                className: 'bw-mode',
                title: DICT.deleteTip,
                onClick: (event) => {
                  if (event && event.stopPropagation) event.stopPropagation();
                  if (props.deletePersona) props.deletePersona(doc);
                },
              },
              DICT.deleteLabel
            ),
          ]);
        };
        return h('div', {}, [
          h('div', { key: 'bar', style: S.tabBar }, [
            h(
              'button',
              {
                key: 'new',
                type: 'button',
                className: 'bw-ghost',
                style: S.ghostBtn,
                onClick: () => {
                  if (props.onCreatePersona) props.onCreatePersona();
                },
              },
              '＋ ' + DICT.newPersona
            ),
          ]),
          personas.length === 0
            ? h(Empty, { text: DICT.emptyPersona, hint: DICT.emptyPersonaHint })
            : h(Group, {
                key: 'p',
                title: '人格',
                docs: personas,
                plain: true,
                onEdit: props.onEdit,
                actionOf,
                badgeOf: (doc) => (doc.path === activeFile ? DICT.active : DICT.dormant),
              }),
        ]);
      }

      if (tab.id === 'memory') {
        const recent = (d.memory && d.memory.recent) || [];
        const archive = (d.memory && d.memory.archive) || [];
        const tongyou = d.tongyou || d.about || null;
        const self = d.self || [];
        // 巩固要由我来写那段小结，面板里没有输入框——所以这个按钮只做一件事：
        // 把该说的话复制到剪贴板，你粘进输入框就成。
        const askConsolidate = async () => {
          const item = DICT.quick.items.filter((i) => i.id === 'consolidate')[0];
          try {
            await navigator.clipboard.writeText(item.draft);
            window.alert(DICT.consolidateCopied);
          } catch (err) {
            window.alert(DICT.consolidateManual + '\n\n' + item.draft);
          }
        };
        if (recent.length + archive.length + (tongyou ? 1 : 0) === 0) {
          return h('div', {}, [
            h(Empty, { key: 'e', text: DICT.emptyMemory, hint: DICT.emptyMemoryHint }),
            h(Group, {
              key: 'self',
              title: '自述 · ' + (d.activePersona || '她') + ' 自己的小记（不进上下文）',
              docs: self,
              plain: true,
            }),
          ]);
        }
        return h('div', {}, [
          h('div', { key: 'bar', style: S.tabBar }, [
            h(
              'button',
              {
                key: 'tidy',
                type: 'button',
                className: 'bw-ghost',
                style: S.ghostBtn,
                title: DICT.tidyTip,
                onClick: () => {
                  if (props.tidyTongyou) props.tidyTongyou();
                },
              },
              DICT.tidyTongyou
            ),
            h(
              'button',
              {
                key: 'consolidate',
                type: 'button',
                className: 'bw-ghost',
                style: S.ghostBtn,
                title: DICT.consolidateTip,
                onClick: askConsolidate,
              },
              DICT.consolidateLabel
            ),
          ]),
          h(Group, {
            key: 'ty',
            title: DICT.aboutMe,
            docs: tongyou ? [tongyou] : [],
            onEdit: props.onEdit,
            plain: true,
          }),
          h(Group, { key: 'r', title: DICT.recent, docs: recent, onEdit: props.onEdit }),
          h(Group, { key: 'a', title: DICT.archive, docs: archive, onEdit: props.onEdit }),
          h(Group, {
            key: 'self',
            title: '自述 · ' + (d.activePersona || '她') + ' 自己的小记（不进上下文）',
            docs: self,
            onEdit: props.onEdit,
            plain: true,
          }),
        ]);
      }

      if (tab.id === 'workshop') {
        const always = (d.workshop && d.workshop.always) || [];
        const onDemand = (d.workshop && d.workshop.onDemand) || [];
        const newBar = h('div', { key: 'bar', style: S.tabBar }, [
          h(
            'button',
            {
              key: 'new',
              type: 'button',
              className: 'bw-ghost',
              style: S.ghostBtn,
              onClick: () => {
                if (props.onCreateWorkshop) props.onCreateWorkshop();
              },
            },
            '＋ ' + DICT.newWorkshop
          ),
        ]);
        const actionOf = (doc) =>
          h(
            'button',
            {
              key: 'a',
              type: 'button',
              className: 'bw-mode',
              title: doc.always ? DICT.modeOnTip : DICT.modeOffTip,
              'data-on': doc.always ? 'true' : 'false',
              onClick: (event) => {
                if (event && event.stopPropagation) event.stopPropagation();
                if (props.toggleMode) props.toggleMode(doc);
              },
            },
            doc.always ? DICT.alwaysOn : DICT.alwaysOff
          );
        return h('div', {}, [
          newBar,
          always.length + onDemand.length === 0
            ? h(Empty, { key: 'e', text: DICT.emptyWorkshop, hint: DICT.emptyWorkshopHint })
            : h('div', { key: 'g' }, [
                h(Group, { key: 'w1', title: DICT.alwaysOn, docs: always, actionOf, onEdit: props.onEdit }),
                h(Group, { key: 'w2', title: DICT.alwaysOff, docs: onDemand, actionOf, onEdit: props.onEdit }),
              ]),
        ]);
      }

      if (tab.id === 'sealed') {
        const boxes = d.sealedPersonas || [];
        const docs = d.sealed || [];
        if (boxes.length + docs.length === 0) return h(Empty, { text: DICT.emptySealed, hint: DICT.emptySealedHint });

        // Explorer opens the item's parent, so the box is seen among its siblings.
        const actionOf = (doc, mainLabel, mainTip) =>
          h('span', { key: 'a', style: S.rowActions }, [
            h(
              'button',
              {
                key: 'r',
                type: 'button',
                className: 'bw-mode',
                title: mainTip,
                onClick: (event) => {
                  if (event && event.stopPropagation) event.stopPropagation();
                  if (props.unsealDoc) props.unsealDoc(doc);
                },
              },
              mainLabel
            ),
            h(
              'button',
              {
                key: 'f',
                type: 'button',
                className: 'bw-mode',
                title: doc.kind === 'persona' ? DICT.folderBoxTip : DICT.folderDocTip,
                onClick: (event) => {
                  if (event && event.stopPropagation) event.stopPropagation();
                  if (props.revealPath) {
                    const pending = props.revealPath(doc.path);
                    if (pending && pending.catch) pending.catch(() => {});
                  }
                },
              },
              DICT.folderLabel
            ),
          ]);

        return h('div', {}, [
          h(Group, {
            key: 'b',
            title: DICT.sealedPersonaGroup,
            docs: boxes,
            badgeOf: () => DICT.personaBadge,
            actionOf: (doc) => actionOf(doc, DICT.restorePersonaLabel, DICT.restorePersonaTip),
          }),
          h(Group, {
            key: 'd',
            title: DICT.sealedDocGroup,
            docs,
            actionOf: (doc) => actionOf(doc, DICT.restoreLabel, '放回原来的位置'),
          }),
        ]);
      }

      return null;
    }

    /* ---------------------------------------------------------------- */
    /* Settings                                                          */
    /* ---------------------------------------------------------------- */

    function SettingsDrawer(props) {
      const st = DICT.settings;
      const settings = (props.data && props.data.settings) || {};
      const [name, setName] = useState(settings.name || '');
      const [status, setStatus] = useState('');
      const [pendingRoot, setPendingRoot] = useState('');
      const [rootBusy, setRootBusy] = useState(false);
      const [rootStatus, setRootStatus] = useState('');

      const rootError = (err) => String((err && err.message) || err || st.failed);

      // Picking only chooses a folder; nothing moves until one of the two
      // confirmations below is pressed, so a mis-click cannot relocate anything.
      const chooseRoot = () => {
        setRootStatus('');
        setRootBusy(true);
        props
          .root({ action: 'pick', initial: (props.data && props.data.dataDir) || '' })
          .then((res) => {
            setRootBusy(false);
            if (!res) return;
            if (res.error) {
              setRootStatus(res.error);
              return;
            }
            if (res.path) setPendingRoot(res.path);
          })
          .catch((err) => {
            setRootBusy(false);
            setRootStatus(rootError(err));
          });
      };

      const applyRoot = (move) => {
        if (!pendingRoot) return;
        setRootBusy(true);
        setRootStatus(move ? st.rootMoving : '');
        props
          .root({ action: 'set', target: pendingRoot, move })
          .then((res) => {
            setRootBusy(false);
            if (!res) return;
            if (res.error) {
              setRootStatus(res.error);
              return;
            }
            setPendingRoot('');
            setRootStatus(st.rootDone + '：' + res.root);
          })
          .catch((err) => {
            setRootBusy(false);
            setRootStatus(rootError(err));
          });
      };

      const resetRoot = () => {
        setRootBusy(true);
        props
          .root({ action: 'reset' })
          .then((res) => {
            setRootBusy(false);
            if (res && res.error) {
              setRootStatus(res.error);
              return;
            }
            setRootStatus(st.rootResetDone);
          })
          .catch((err) => {
            setRootBusy(false);
            setRootStatus(rootError(err));
          });
      };

      const persist = (patch) => {
        setStatus('');
        props
          .save(patch)
          .then((res) => {
            setStatus(res && res.settings ? st.saved : st.failed);
            if (res && res.settings) props.onSaved(res.settings);
          })
          .catch(() => setStatus(st.failed));
      };

      // 一键备份：整库复制到隔壁，路径和体积当面告诉你
      const [backupBusy, setBackupBusy] = useState(false);
      const [backupStatus, setBackupStatus] = useState('');
      const backupNow = () => {
        if (backupBusy) return;
        setBackupBusy(true);
        setBackupStatus('');
        props
          .backup()
          .then((res) => {
            setBackupBusy(false);
            if (res && res.path) {
              setBackupStatus(
                st.backupDone.replace('{path}', res.path).replace('{files}', res.files).replace('{size}', res.human)
              );
            } else {
              setBackupStatus(st.backupFailed + ((res && res.error) || ''));
            }
          })
          .catch((err) => {
            setBackupBusy(false);
            setBackupStatus(st.backupFailed + rootError(err));
          });
      };

      return h('aside', { style: S.drawer, role: 'dialog', 'aria-label': st.heading }, [
        h('div', { key: 'head', style: S.drawerHead }, [
          h('div', { key: 't', style: S.drawerTitle }, st.heading),
          h(
            'button',
            {
              key: 'x',
              type: 'button',
              style: S.iconBtn,
              title: DICT.close,
              'aria-label': DICT.close,
              onClick: props.onClose,
            },
            h(CloseGlyph, {})
          ),
        ]),
        h('div', { key: 'body', style: S.drawerBody }, [
          h('div', { key: 'name', style: S.field }, [
            h('label', { key: 'l', style: S.fieldLabel, htmlFor: 'buwang-name' }, st.nameLabel),
            h('input', {
              key: 'i',
              id: 'buwang-name',
              className: 'bw-input',
              style: S.input,
              value: name,
              placeholder: '你的名字',
              onChange: (e) => setName(e.target.value),
              onBlur: () => {
                if (name !== settings.name) persist({ name });
              },
            }),
            h('div', { key: 'h', style: S.fieldHint }, st.nameHint),
          ]),

          h('div', { key: 'budget', style: S.field }, [
            h('span', { key: 'l', style: S.fieldLabel }, st.budgetLabel),
            h(
              'div',
              { key: 's', style: S.segmented },
              st.budgetOptions.map((opt) =>
                h(
                  'button',
                  {
                    key: opt.id,
                    type: 'button',
                    style:
                      settings.budget === opt.id ? Object.assign({}, S.segment, S.segmentActive) : S.segment,
                    onClick: () => persist({ budget: opt.id }),
                  },
                  opt.label + ' · ' + opt.value
                )
              )
            ),
          ]),

          h('div', { key: 'recentDays', style: S.field }, [
            h('span', { key: 'l', style: S.fieldLabel }, st.recentDaysLabel),
            h(
              'div',
              { key: 's', style: S.segmented },
              st.recentDaysOptions.map((n) =>
                h(
                  'button',
                  {
                    key: n,
                    type: 'button',
                    style:
                      Number(settings.recentDays || 3) === n
                        ? Object.assign({}, S.segment, S.segmentActive)
                        : S.segment,
                    onClick: () => persist({ recentDays: n }),
                  },
                  n + ' 天'
                )
              )
            ),
          ]),

          h('div', { key: 'keepDays', style: S.field }, [
            h('span', { key: 'l', style: S.fieldLabel }, st.keepDaysLabel),
            h(
              'div',
              { key: 's', style: S.segmented },
              st.keepDaysOptions.map((n) =>
                h(
                  'button',
                  {
                    key: n,
                    type: 'button',
                    style:
                      Number(settings.keepDays || 2) === n
                        ? Object.assign({}, S.segment, S.segmentActive)
                        : S.segment,
                    onClick: () => persist({ keepDays: n }),
                  },
                  n + ' 天'
                )
              )
            ),
          ]),

          h('div', { key: 'cons', style: S.field }, [
            h('span', { key: 'l', style: S.fieldLabel }, st.consolidateLabel),
            h(
              'div',
              { key: 'v', style: S.value },
              '满 ' + (settings.recentLimit || 40) + ' 条 · 或满 ' + (settings.consolidateDays || 30) + ' 天'
            ),
          ]),

          h('div', { key: 'data', style: S.field }, [
            h('span', { key: 'l', style: S.fieldLabel }, st.dataLabel),
            h('div', { key: 'v', style: S.value }, props.data ? props.data.dataDir : ''),
            h(
              'div',
              { key: 'g', style: S.grid2 },
              [
                [st.openRoot, () => props.reveal('').catch(() => {})],
                [st.pickRoot, chooseRoot, rootBusy],
                [st.resetRoot, resetRoot, rootBusy],
                [st.backupLabel, backupNow, backupBusy],
              ].map(([label, run, disabled]) =>
                h(
                  'button',
                  {
                    key: label,
                    type: 'button',
                    className: 'bw-ghost',
                    style: S.ghostBtn,
                    disabled: !!disabled,
                    onClick: run,
                  },
                  label
                )
              )
            ),

            pendingRoot
              ? h('div', { key: 'pend', style: S.field }, [
                  h('div', { key: 'p', style: S.value }, st.rootPending + ' ' + pendingRoot),
                  h(
                    'div',
                    { key: 'g', style: S.grid2 },
                    [
                      [st.rootMove, () => applyRoot(true), rootBusy],
                      [st.rootPoint, () => applyRoot(false), rootBusy],
                      [st.rootCancel, () => setPendingRoot(''), rootBusy],
                    ].map(([label, run, disabled]) =>
                      h(
                        'button',
                        {
                          key: label,
                          type: 'button',
                          className: 'bw-ghost',
                          style: S.ghostBtn,
                          disabled: !!disabled,
                          onClick: run,
                        },
                        label
                      )
                    )
                  ),
                ])
              : null,

            rootStatus ? h('div', { key: 'rh', style: S.fieldHint }, rootStatus) : null,
            backupStatus
              ? h(
                  'div',
                  { key: 'bh', style: Object.assign({}, S.fieldHint, { whiteSpace: 'pre-line' }) },
                  backupStatus
                )
              : null,
            h('div', { key: 'dh', style: S.fieldHint }, st.dataHint),
          ]),

          h('div', { key: 'div', style: S.divider }),

          h('div', { key: 'open', style: S.field }, [
            h('span', { key: 'l', style: S.fieldLabel }, st.openLabel),
            h(
              'div',
              { key: 'g', style: S.grid2 },
              st.openItems.map((label) =>
                h(
                  'button',
                  {
                    key: label,
                    type: 'button',
                    className: 'bw-ghost',
                    style: S.ghostBtn,
                    onClick: () => {
                      props.reveal(label).catch(() => {});
                    },
                  },
                  label
                )
              )
            ),
          ]),

          status ? h('div', { key: 'st', style: S.fieldHint }, status) : null,
        ]),
      ]);
    }

    /* ---------------------------------------------------------------- */
    /* Document editor                                                   */
    /* ---------------------------------------------------------------- */

    /** One line telling the user how this particular document is used. */
    function injectHint(relPath) {
      const at = String(relPath || '');
      if (at.indexOf('人格/') === 0) return DICT.injectHints.core;
      if (/\/同游\.md$/.test(at)) return DICT.injectHints.about;
      if (at.indexOf('记忆/') === 0) return DICT.injectHints.memory;
      if (at.indexOf('工坊/') === 0) return DICT.injectHints.workshop;
      if (at.indexOf('封存/') === 0) return DICT.injectHints.sealed;
      return '';
    }

    /**
     * Sharing picker: which other persona's archive this one may read.
     * It saves on every toggle, so the switch is live — no separate save step.
     */
    function SharePicker(props) {
      const [picked, setPicked] = useState(props.current || []);
      const [status, setStatus] = useState('');

      const toggle = (name) => {
        const next = picked.indexOf(name) >= 0 ? picked.filter((item) => item !== name) : picked.concat(name);
        setPicked(next);
        props
          .onChange(next)
          .then((res) => {
            if (res && res.error) setStatus(res.error);
            else setStatus('');
          })
          .catch((err) => setStatus(String((err && err.message) || err)));
      };

      if (!props.others || props.others.length === 0) return null;

      return h('div', {}, [
        h('span', { key: 'l', style: S.fieldLabel }, DICT.shareLabel),
        h('div', { key: 'h', style: S.fieldHint }, DICT.shareHint),
        h(
          'div',
          { key: 'c', style: S.chips },
          props.others.map((name) =>
            h(
              'button',
              {
                key: name,
                type: 'button',
                className: 'bw-mode',
                'data-on': picked.indexOf(name) >= 0 ? 'true' : 'false',
                onClick: () => toggle(name),
              },
              name
            )
          )
        ),
        status ? h('div', { key: 's', style: S.fieldHint }, status) : null,
      ]);
    }

    function DocEditor(props) {
      const d = DICT.editor;
      const doc = props.doc;
      const creating = props.mode === 'create';
      const isWorkshopCreate = creating && props.kind === 'workshop';
      // A persona is 名字 + 正文; a one-line summary of "who am I" would only
      // repeat the name, so the field is hidden for both persona modes.
      const isPersona =
        props.kind === 'persona' ||
        (creating && props.kind !== 'workshop') ||
        String(doc.path || '').indexOf('人格/') === 0;
      // 自述 never enters the index, so a one-line summary would have nowhere
      // to be read — the field only adds noise. Entering it via tool keeps the
      // front-matter summary that already exists.
      const isSelfNote = String(doc.path || '').indexOf('自述/') === 0;
      // 同游 is injected in full every turn, so its one-line summary is never
      // read anywhere either — same treatment as 自述.
      const isTongyou = /\/同游\.md$/.test(String(doc.path || ''));
      const hideSummary = isPersona || isSelfNote || isTongyou;
      const [title, setTitle] = useState(doc.title || '');
      const [summary, setSummary] = useState(doc.summary || '');
      const [body, setBody] = useState(doc.body || '');
      const [always, setAlways] = useState(false);
      const [status, setStatus] = useState('');
      const [busy, setBusy] = useState(false);

      // 自述：就在这一页里左右翻，不用另开一个「翻成书」的界面。
      // 左 = 更早、右 = 更晚，按钮上直接写那一页的日期和时刻，
      // 免得「上一页 / 下一页」还要在脑子里换算时间方向。
      const siblings = isSelfNote && Array.isArray(props.siblings) ? props.siblings : [];
      const at = siblings.findIndex((item) => item.path === doc.path);
      const prevPage = at > 0 ? siblings[at - 1] : null;
      const nextPage = at >= 0 && at < siblings.length - 1 ? siblings[at + 1] : null;
      const pageLabel = (item) => {
        if (!item) return '';
        const day = String(item.date || '').slice(5) || String(item.title || '');
        return item.logged ? day + ' ' + item.logged : day;
      };
      const dirty = String(title) !== String(doc.title || '') || String(body) !== String(doc.body || '');
      const flipTo = (item) => {
        if (!item || !props.onNavigate) return;
        if (dirty && !window.confirm(d.selfNavDirty)) return;
        props.onNavigate(item.path);
      };

      const submit = () => {
        if (busy) return;
        if (!String(title).trim()) {
          setStatus(d.titleRequired);
          return;
        }
        setBusy(true);
        setStatus('');
        const payload = { path: doc.path, title, body };
        if (!hideSummary) payload.summary = summary;
        if (isWorkshopCreate) payload.always = always;
        props
          .onSave(payload)
          .then((res) => {
            setBusy(false);
            if (!res || res.error || !(res.path || res.key)) setStatus((res && res.error) || d.failed);
          })
          .catch((err) => {
            setBusy(false);
            setStatus(String((err && err.message) || err));
          });
      };

      return h('section', { style: S.editor, role: 'dialog', 'aria-label': d.heading }, [
        h('div', { key: 'head', style: S.drawerHead }, [
          h('div', { key: 't', style: S.drawerTitle }, creating ? (isWorkshopCreate ? DICT.newWorkshop : DICT.newPersona) : d.heading + ' · ' + (doc.title || '')),
          h(
            'button',
            {
              key: 'x',
              type: 'button',
              style: S.iconBtn,
              title: DICT.close,
              'aria-label': DICT.close,
              onClick: props.onClose,
            },
            h(CloseGlyph, {})
          ),
        ]),

        isSelfNote && siblings.length > 1
          ? h('div', { key: 'snav', style: S.selfNav }, [
              h(
                'button',
                {
                  key: 'p',
                  type: 'button',
                  className: 'bw-ghost',
                  style: S.ghostBtn,
                  disabled: !prevPage,
                  title: d.selfNavPrevTip,
                  onClick: () => flipTo(prevPage),
                },
                '‹ ' + (prevPage ? pageLabel(prevPage) : d.selfNavPrev)
              ),
              h(
                'div',
                { key: 'n', style: S.selfNavPos },
                siblings.length ? at + 1 + ' / ' + siblings.length : ''
              ),
              h(
                'button',
                {
                  key: 'nx',
                  type: 'button',
                  className: 'bw-ghost',
                  style: S.ghostBtn,
                  disabled: !nextPage,
                  title: d.selfNavNextTip,
                  onClick: () => flipTo(nextPage),
                },
                (nextPage ? pageLabel(nextPage) : d.selfNavNext) + ' ›'
              ),
            ])
          : null,

        h('div', { key: 'body', style: S.editorBody }, [
          h('div', { key: 'title', style: S.field }, [
            h('label', { key: 'l', style: S.fieldLabel, htmlFor: 'buwang-doc-title' }, d.titleLabel),
            h('input', {
              key: 'i',
              id: 'buwang-doc-title',
              className: 'bw-input',
              style: S.input,
              value: title,
              placeholder: d.titlePlaceholder,
              onChange: (e) => setTitle(e.target.value),
            }),
          ]),

          hideSummary
            ? null
            : h('div', { key: 'sum', style: S.field }, [
                h('label', { key: 'l', style: S.fieldLabel, htmlFor: 'buwang-doc-summary' }, d.summaryLabel),
                h('input', {
                  key: 'i',
                  id: 'buwang-doc-summary',
                  className: 'bw-input',
                  style: S.input,
                  value: summary,
                  placeholder: d.summaryPlaceholder,
                  onChange: (e) => setSummary(e.target.value),
                }),
                h('div', { key: 'h', style: S.fieldHint }, d.summaryHint),
              ]),

          isWorkshopCreate
            ? h('label', { key: 'now', style: S.checkRow }, [
                h('input', {
                  key: 'c',
                  type: 'checkbox',
                  checked: always,
                  onChange: (e) => setAlways(!!(e && e.target && e.target.checked)),
                }),
                h('span', { key: 'l', style: S.checkLabel }, DICT.enableNow),
                h('span', { key: 'h', style: S.fieldHint }, DICT.enableNowHint),
              ])
            : null,

          h('div', { key: 'bod', style: S.fieldGrow }, [
            h('label', { key: 'l', style: S.fieldLabel, htmlFor: 'buwang-doc-body' }, d.bodyLabel),
            h('div', { key: 'h', style: S.bodyHint }, injectHint(isWorkshopCreate ? '工坊/' : doc.path)),
            h('textarea', {
              key: 'a',
              id: 'buwang-doc-body',
              className: 'bw-textarea',
              style: S.textarea,
              value: body,
              spellCheck: false,
              onChange: (e) => setBody(e.target.value),
            }),
          ]),

          props.shareUi ? h('div', { key: 'share', style: S.field }, [props.shareUi]) : null,
          status ? h('div', { key: 'st', style: S.fieldHint }, status) : null,
        ]),

        h('div', { key: 'foot', style: S.editorFoot }, [
          props.onSeal
            ? h(
                'button',
                {
                  key: 'seal',
                  type: 'button',
                  className: 'bw-ghost',
                  style: S.ghostBtn,
                  title: DICT.sealTip,
                  onClick: props.onSeal,
                },
                DICT.sealLabel
              )
            : null,
          h('div', { key: 'sp', style: { flex: 1 } }),
          h(
            'button',
            {
              key: 'c',
              type: 'button',
              className: 'bw-ghost',
              style: S.ghostBtn,
              onClick: props.onClose,
            },
            d.cancel
          ),
          h(
            'button',
            {
              key: 's',
              type: 'button',
              className: 'bw-primary',
              style: S.primaryBtn,
              disabled: busy,
              onClick: submit,
            },
            busy ? d.saving : d.save
          ),
        ]),
      ]);
    }

    /* ---------------------------------------------------------------- */
    /* Panel                                                             */
    /* ---------------------------------------------------------------- */

    function BuwangPanel(props) {
      const [data, setData] = useState(null);
      const [error, setError] = useState('');
      const [active, setActive] = useState('persona');
      const [settingsOpen, setSettingsOpen] = useState(false);
      const [editing, setEditing] = useState(null);
      const [creating, setCreating] = useState(false);
      const [creatingWorkshop, setCreatingWorkshop] = useState(false);
      const tab = DICT.tabs.filter((t) => t.id === active)[0] || DICT.tabs[0];

      const load = () => {
        setError('');
        return props
          .call('state')
          .then((res) => {
            if (res && res.dataDir) setData(res);
            else if (res && res.error) setError(res.error);
            else setError('unexpected response');
          })
          .catch((err) => setError(String((err && err.message) || err)));
      };

      useEffect(() => {
        load();
      }, []);

      return h('div', { style: S.root }, [
        h('style', { key: 'css' }, CSS),
        h('header', { key: 'head', style: S.header }, [
          h('div', { key: 'tw', style: S.titleWrap }, [
            h('div', { key: 't', style: S.title }, DICT.title),
            h('div', { key: 's', style: S.subtitle }, DICT.subtitle),
          ]),
          h(
            'button',
            {
              key: 'gear',
              type: 'button',
              className: 'bw-gear',
              title: DICT.gear,
              'aria-label': DICT.gear,
              'aria-expanded': settingsOpen,
              'data-open': settingsOpen ? 'true' : 'false',
              onClick: () => setSettingsOpen((v) => !v),
            },
            [h(GearGlyph, { key: 'g' }), h('span', { key: 't' }, DICT.gear)]
          ),
        ]),

        h(
          'nav',
          { key: 'tabs', style: S.tabs, role: 'tablist' },
          DICT.tabs.map((t) =>
            h(
              'button',
              {
                key: t.id,
                type: 'button',
                role: 'tab',
                className: 'bw-tab',
                'aria-selected': t.id === active,
                'data-active': t.id === active ? 'true' : 'false',
                style: t.id === active ? Object.assign({}, S.tab, S.tabActive) : S.tab,
                onClick: () => setActive(t.id),
              },
              t.label
            )
          )
        ),

        h('div', { key: 'body', className: 'bw-body', style: S.body }, [
          h('div', { key: 'desc', style: S.sectionBody }, tab.body),

          error
            ? h('div', { key: 'err', style: S.error }, [
                h('div', { key: 'm' }, error),
                h(
                  'button',
                  {
                    key: 'r',
                    type: 'button',
                    className: 'bw-ghost',
                    style: S.ghostBtn,
                    onClick: () => {
                      setData(null);
                      load();
                    },
                  },
                  DICT.retry
                ),
              ])
            : null,

          !error && !data ? h('div', { key: 'load', style: S.sectionBody }, DICT.loading) : null,

          data
            ? h(TabBody, {
                key: 'tab',
                tab,
                data,
                toggleMode: (doc) => {
                  props
                    .call('workshop-mode', { path: doc.path, always: !doc.always })
                    .then((res) => {
                      if (res && res.path) load();
                      return res;
                    });
                },
                onEdit: (doc) => setEditing(doc),
                onCreatePersona: () => setCreating(true),
                onCreateWorkshop: () => setCreatingWorkshop(true),
                tidyTongyou: () => {
                  // Preview first: 同游 is the page that rides every turn, so a
                  // wrong tidy is expensive to notice. Show what leaves, then ask.
                  const body = String(((data && (data.tongyou || data.about)) || {}).body || '');
                  const items = body
                    .split(/\r?\n/)
                    .filter((line) => /^\s*-\s+/.test(line) || /^\s*##\s+/.test(line));
                  const keep = 20;
                  const ask = typeof window !== 'undefined' && typeof window.confirm === 'function';
                  if (items.length <= keep) {
                    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
                      window.alert(DICT.tidyNothing.replace('{n}', String(items.length)));
                    }
                    return;
                  }
                  const move = items.slice(0, items.length - keep);
                  const head = move
                    .slice(0, 3)
                    .map((line) => '· ' + line.replace(/^\s*-\s+/, ''))
                    .join('\n');
                  const more = move.length > 3 ? '\n…还有 ' + (move.length - 3) + ' 条' : '';
                  const text =
                    DICT.tidyAsk.replace('{move}', String(move.length))
                      .replace('{total}', String(items.length))
                      .replace('{keep}', String(keep)) +
                    '\n\n' +
                    head +
                    more;
                  if (!ask || !window.confirm(text)) return;
                  props.call('tidy', { keep }).then((res) => {
                    if (res && res.path) load();
                    return res;
                  });
                },
                unsealDoc: (doc) => {
                  const action = doc.kind === 'persona' ? 'restore-persona' : 'unseal';
                  props.call('seal', { path: doc.path, action }).then((res) => {
                    if (res && res.path) load();
                    return res;
                  });
                },
                revealPath: (rel) => props.call('reveal', { path: rel }),
                activatePersona: (doc) => {
                  const key = String(doc.path || '')
                    .replace(/^人格\//, '')
                    .replace(/\.md$/, '');
                  props.call('persona', { action: 'activate', key }).then((res) => {
                    if (res && res.activePersona) load();
                    return res;
                  });
                },
                deletePersona: (doc) => {
                  const key = String(doc.path || '')
                    .replace(/^人格\//, '')
                    .replace(/\.md$/, '');
                  const ask = typeof window !== 'undefined' && typeof window.confirm === 'function';
                  if (ask && !window.confirm('把「' + doc.title + '」整个搬到封存？\n人格、记忆、工坊一起走，想找回来还在。')) return;
                  props.call('persona', { action: 'delete', key }).then((res) => {
                    if (res && res.path) load();
                    return res;
                  });
                },
              })
            : null,
        ]),

        settingsOpen && data
          ? h(SettingsDrawer, {
              key: 'drawer',
              data,
              onClose: () => setSettingsOpen(false),
              save: (patch) => props.call('settings', { settings: patch }).then((res) => {
                if (res && res.settings) {
                  const next = Object.assign({}, data, { settings: res.settings });
                  setData(next);
                }
                return res;
              }),
              reveal: (which) => props.call('reveal', { which }),
              root: (payload) => props.call('root', payload),
              backup: () => props.call('backup', {}),
              onSaved: () => {},
            })
          : null,

        creating
          ? h(DocEditor, {
              key: 'create-persona',
              mode: 'create',
              doc: { path: '', title: '', summary: '', body: '' },
              onClose: () => setCreating(false),
              onSave: (payload) =>
                props
                  .call('persona', { action: 'create', title: payload.title, body: payload.body })
                  .then((res) => {
                    if (res && res.path) {
                      setCreating(false);
                      load();
                    }
                    return res;
                  }),
            })
          : null,

        creatingWorkshop
          ? h(DocEditor, {
              key: 'create-workshop',
              mode: 'create',
              kind: 'workshop',
              doc: { path: '', title: '', summary: '', body: '' },
              onClose: () => setCreatingWorkshop(false),
              onSave: (payload) =>
                props
                  .call('doc', {
                    action: 'create-workshop',
                    title: payload.title,
                    summary: payload.summary,
                    body: payload.body,
                    always: payload.always === true,
                  })
                  .then((res) => {
                    if (res && res.path) {
                      setCreatingWorkshop(false);
                      load();
                    }
                    return res;
                  }),
            })
          : null,

        editing && data
          ? h(DocEditor, {
              // 换了页就重开一次组件，标题/正文的草稿不会带到下一页去
              key: 'editor:' + String(editing.path || ''),
              doc: editing,
              siblings: (data.self || []).slice().sort((a, b) => {
                const ka = String(a.date || '') + ' ' + String(a.logged || '');
                const kb = String(b.date || '') + ' ' + String(b.logged || '');
                return ka < kb ? -1 : ka > kb ? 1 : 0;
              }),
              onNavigate: (path) => {
                const found = (data.self || []).filter((item) => item.path === path)[0];
                if (found) setEditing(found);
              },
              shareUi:
                String(editing.path || '').indexOf('人格/') === 0
                  ? h(SharePicker, {
                      current: editing.share || [],
                      others: (data.personas || [])
                        .map((doc) =>
                          String(doc.path || '')
                            .replace(/^人格\//, '')
                            .replace(/\.md$/, '')
                        )
                        .filter((name) => name && name !== String(editing.path || '').replace(/^人格\//, '').replace(/\.md$/, '')),
                      onChange: (shareFrom) =>
                        props.call('persona', {
                          action: 'share',
                          key: String(editing.path || '').replace(/^人格\//, '').replace(/\.md$/, ''),
                          shareFrom,
                        }),
                    })
                  : null,
              onClose: () => setEditing(null),
              onSeal: /^(记忆|工坊)\//.test(String(editing.path || ''))
                ? () => {
                    props.call('seal', { path: editing.path }).then((res) => {
                      if (res && res.path) {
                        setEditing(null);
                        load();
                      }
                      return res;
                    });
                  }
                : null,
              onSave: (payload) =>
                props.call('doc', payload).then((res) => {
                  if (res && res.path) {
                    setEditing(null);
                    load();
                  }
                  return res;
                }),
            })
          : null,

      ]);
    }

    /* ---------------------------------------------------------------- */
    /* Registration                                                      */
    /* ---------------------------------------------------------------- */

    return {
      inject: ['slots'],
      apply(ctx) {
        // The panel talks to the Host over its own exact routes (see index.js):
        // reads are GET, writes are POST with a small JSON body.
        const call = async (endpoint, payload) => {
          const isRead = endpoint === 'state';
          const init = isRead
            ? { method: 'GET', credentials: 'same-origin' }
            : {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload || {}),
              };
          try {
            const res = await fetch('/buwang/' + endpoint, init);
            const text = await res.text();
            if (!res.ok) return { error: 'HTTP ' + res.status + ' · ' + text.slice(0, 160) };
            try {
              return JSON.parse(text);
            } catch {
              return { error: '返回的不是 JSON' };
            }
          } catch (err) {
            return { error: String((err && err.message) || err) };
          }
        };

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'buwang', order: 5, label: () => DICT.title },
            BuwangIcon
          )
        );

        const openPanel = () => {
          try {
            const layout = ctx.get('layout');
            if (layout && typeof layout.selectPanel === 'function') layout.selectPanel('buwang');
          } catch (err) {
            // navigation is best-effort; the sidebar icon still works
          }
        };

        ctx.slots.inject('conversation.input.left', () =>
          ctx.slots.register(
            { name: 'conversation.input.left', id: 'buwang-quick', order: 15 },
            function QuickSlot(slotProps) {
              return h(QuickButton, Object.assign({}, slotProps, { openPanel }));
            }
          )
        );

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'buwang' }, function MainPanel(slotProps) {
            return h(BuwangPanel, Object.assign({}, slotProps, { call }));
          })
        );
      },
    };
  },
});
