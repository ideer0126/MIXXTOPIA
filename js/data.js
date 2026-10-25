/**
 * js/data.js —— 关卡数据：6 关地图 + 对话 + 谜题（数据驱动）
 * 所属任务：Issue #11 地图数据（未开始，levels 暂空） / Issue #12 对话文案（已接入）。
 *
 * 数据格式规格见 docs/GAME_DESIGN.md §11（GAME 全局对象：
 * meta / scenes / characters / levels / dialogue / saveKey）。
 * 对话节点规格见 GAME_DESIGN.md §7：type / trigger / once / entry / scopeId /
 * lines（{s 说话人, t 台词}）/ options（{label, goto}）/ next。
 *
 * 台词稿见 GAME_DESIGN.md §8（v0.4，2026-10-24 关 1 剧情重制：
 * 梦核幼儿园生日派对 + 幼儿园表演妆造；v0.3 的神话倒影与小分队名单沿用）。
 *
 * 约定：
 * - trigger 取值：npc:<实体id> / star:<星id> / clear:<关卡id> / load:<关卡或场景id> /
 *   sheep:<黑羊实体id> / cake（关 6 蛋糕）。实体 id 与星 id 在 Issue #11 地图落地时
 *   与本节触发键一一对应（sheepN = 第 N 关黑羊；star 的星 id 由地图实体定义）。
 * - entry:true 仅标注 clear:/load: 自动作用域入口（与 tools/validate.js #30 约定一致）；
 *   star:/sheep:/cake 节点按 trigger 直接调度、不设 entry。NPC 互动节点与选项分支
 *   节点（l3.dj.right / l3.dj.wrong）同样不设 entry（由引擎按 §7 的
 *   「首次 intro → 此后 hint」规则解析）。
 * - once 节点仅首次播放；播放记录由 Issue #8 持久化到 localStorage
 *   （对应存档位的 played 列表），读档后不再重播。
 */
'use strict';

(function (root) {
  'use strict';

  const GAME = {
    meta: { version: '1.0', tile: 16, viewport: { w: 20, h: 14 } },

    /* 独立场景作用域（序章等）：场景系统由 Issue #11 接入 */
    scenes: {
      p0: { title: '生日夜的房间' },
    },

    /* 说话人字典（GAME_DESIGN.md §3：姓名框色与显示名） */
    characters: {
      lily: { name: 'Lily', color: '#7FB8E6' },
      haewon: { name: 'Haewon', color: '#FFB14E' },
      sullyoon: { name: 'Sullyoon', color: '#B49BFF' },
      bae: { name: 'Bae', color: '#FF7BA9' },
      jiwoo: { name: 'Jiwoo', color: '#FFE066' },
      kyujin: { name: 'Kyujin', color: '#5EE6B8' },
      byeori: { name: 'Byeori', color: '#FFD700' },
      dj: { name: '街头DJ', color: '#FF5D8F' },
      sheep: { name: '黑羊', color: '#B8A8E0' },
      nar: { name: '', color: '#C0C0C0' },       // 旁白：隐藏姓名标签
      all: { name: '全员', color: '#FFFFFF' },   // 伪说话人（仅结局合唱行）
    },

    /* 关卡列表：地图与实体由 Issue #11 落地（main.js 在其就位前使用内置占位关卡） */
    levels: [],

    /* ══════════ 对话稿（GAME_DESIGN.md §8，v0.3 全文） ══════════ */

    dialogue: {
      /* ── 序章（自动演出：进入 p0 场景时触发） ── */
      p0: {
        type: 'cutscene',
        trigger: 'load:p0',
        scopeId: 'p0',
        entry: true,
        once: true,
        lines: [
          { s: 'nar', t: '生日夜的钟声，敲过第十二下。' },
          { s: 'nar', t: '你对着流星，许了一个很长的愿望——「긴 소원」。' },
          { s: 'nar', t: '紫色的天空里，一匹飞马踏过星光……' },
          { s: 'byeori', t: 'NSWER！欢迎来到 MIXXTOPIA！我是星星精灵 Byeori，딩동댕！' },
          { s: 'byeori', t: '这里是包容无数个体的共生世界——每一天，都在为新的缪斯举办生日派对。' },
          { s: 'byeori', t: '六位缪斯的愿望化作了星星，可它们散落了，灵感之泉也干涸了。' },
          { s: 'byeori', t: '请帮缪斯们找回全部 25 颗愿望之星，点亮许愿蛋糕——你和缪斯们互为彼此的专属缪斯，你的生日愿望，就是她们的愿望！' },
          { s: 'byeori', t: '操作教学：方向键 / WASD 移动，E 或空格互动。手机用屏幕方向键和 A 键。' },
          { s: 'byeori', t: '先去找 Lily 吧。第一颗星星就在前面的路上。응답하라 NSWER！' },
        ],
      },

      /* ── 关 1 · Birthday Wish（梦核幼儿园生日派对） ── */
      'l1.intro': {
        type: 'intro',
        trigger: 'npc:lily',
        once: true,
        lines: [
          { s: 'nar', t: '生日夜的钟声敲过第十二下。你睁开眼，站在一间幼儿园礼堂门口。' },
          { s: 'nar', t: '彩带、气球、一排排塑料小椅子，有一半空着。灯管嗡嗡响。你十八岁了，可这里的一切，还是小时候的样子。' },
          { s: 'nar', t: '你低头看了看自己的手——十八岁的手，没有变小。可那些小椅子，只到你的膝盖。' },
          { s: 'lily', t: 'NSWER！欢迎来参加你的生日会！纸皇冠歪了？不管啦，今天你才是主角。' },
          { s: 'haewon', t: '别愣着，小寿星。我们六个可是认真化了妆、换了演出服。幼儿园文艺汇演限定版——身体没变小，放心。' },
          { s: 'lily', t: '这里的彩带、椅子、蛋糕，都是照着你记忆里的生日会摆的。可蜡烛都灭了——愿望之星一散，生日会就停在这一刻。' },
          { s: 'haewon', t: '帮我们找回三颗愿望之星吧。集齐了，蜡烛就能重新亮起来。' },
          { s: 'lily', t: '先收下气球拱门下那颗——小时候的第一颗糖，也是第一颗愿望之星。' },
          { s: 'haewon', t: '礼物堆后面还藏着一颗，要把礼物盒推开。最后，和这里的每一位缪斯都聊聊天。六个愿望，一个都不能少。' },
          { s: 'haewon', t: '顺带一提，在这个梦里我们都有神话倒影——Lily 是春天，我是冥王。今天冥王也得当幼儿园小主持人。' },
          { s: 'haewon', t: '操作提示：方向键 / WASD 移动，E 或空格互动。手机用屏幕方向键和 A 键。' },
          { s: 'lily', t: '慢慢来。小时候的生日会，本来就不赶时间。응답하라 NSWER！' },
        ],
        next: 'l1.lily.hint',
      },
      'l1.star1': {
        type: 'star', trigger: 'star:s1', once: true,
        lines: [
          { s: 'lily', t: '第一颗愿望之星！小时候的你，也是在这条路上捡到第一颗糖的吧？' },
          { s: 'haewon', t: '左上角 HUD 会帮你数星星。别嫌我们啰嗦，幼儿园老师都这样。' },
        ],
      },
      'l1.star3': {
        type: 'star', trigger: 'star:s3', once: true,
        lines: [
          { s: 'haewon', t: '哦？蛋糕旁边有东西在发光……六个人都聊过了，最后那颗星星出现了！' },
          { s: 'lily', t: '你看，愿望凑齐的时候，蜡烛就会自己亮起来。' },
          { s: 'nar', t: '十八岁的你站在小小的蛋糕前，忽然想起小时候踮脚吹蜡烛的样子。' },
        ],
      },
      'l1.npc.lily': {
        type: 'npc', trigger: 'npc:lily', once: true,
        lines: [
          { s: 'lily', t: '我是 Lily，今天演「春天的小仙女」。' },
          { s: 'lily', t: '纸花是我自己折的。春天会回来，就像生日每年都会到。' },
          { s: 'lily', t: '所以别怕长大，NSWER。长大，也只是换一件更大的演出服。' },
        ],
      },
      'l1.npc.haewon': {
        type: 'npc', trigger: 'npc:haewon', once: true,
        lines: [
          { s: 'haewon', t: '大班主持人兼解说员，Haewon。玩具话筒归我，吐槽也归我。' },
          { s: 'haewon', t: '冥王来幼儿园当主持，是不是很有反差感？' },
          { s: 'haewon', t: '放心，这个梦不吓人。最多就是椅子矮了点。' },
        ],
      },
      'l1.npc.sullyoon': {
        type: 'npc', trigger: 'npc:sullyoon', once: true,
        lines: [
          { s: 'sullyoon', t: '我今天的节目，是诗朗诵：《一朵开在生日蛋糕上的玫瑰》。' },
          { s: 'sullyoon', t: '爱会让人重生，像海沫里开出的花。' },
          { s: 'sullyoon', t: '你只要坐好，听我念完就好——虽然椅子有点小。' },
        ],
      },
      'l1.npc.bae': {
        type: 'npc', trigger: 'npc:bae', once: true,
        lines: [
          { s: 'bae', t: '小园丁 Bae，报到！花环是纸的，向日葵也是纸的，但力气是真的。' },
          { s: 'bae', t: '大地会记住每一颗种下去的心。生日愿望，也是种下去就会开花的。' },
          { s: 'bae', t: '等会儿吹蜡烛，我帮你一起吹！……开玩笑的，许愿要自己来。' },
        ],
      },
      'l1.npc.jiwoo': {
        type: 'npc', trigger: 'npc:jiwoo', once: true,
        lines: [
          { s: 'jiwoo', t: '信使 Jiwoo，咻——！今天负责给生日会送信……和送气球！' },
          { s: 'jiwoo', t: '我的翅膀是纸板做的，可跑起来一样快。' },
          { s: 'jiwoo', t: '你小时候有没有给未来的自己写过信？我替你送到啦。' },
        ],
      },
      'l1.npc.kyujin': {
        type: 'npc', trigger: 'npc:kyujin', once: true,
        lines: [
          { s: 'kyujin', t: '……小国王 Kyujin。皇冠是纸的，别笑。' },
          { s: 'kyujin', t: '今天你过生日，你说了算。天空看着你呢。' },
          { s: 'kyujin', t: '许愿的时候别怂。……我会假装没看见你闭眼睛。' },
        ],
      },
      'l1.lily.hint': {
        type: 'hint', trigger: 'npc:lily', once: false,
        lines: [
          { s: 'lily', t: '卡住了就看看告示牌，或者再和我们聊聊。生日会不赶时间。' },
          { s: 'lily', t: '小时候的生日会，本来就是要慢慢过的呀。' },
        ],
      },
      'l1.clear': {
        type: 'clear', trigger: 'clear:1', scopeId: 1, entry: true, once: true,
        lines: [
          { s: 'lily', t: '三颗愿望之星，全部归位。小时候的生日会，和十八岁的生日，原来可以同时存在。' },
          { s: 'haewon', t: '蜡烛重新亮起来了。下一站的路，也照亮了。' },
          { s: 'lily', t: '许个愿吧，NSWER。不用变回小孩，也可以被当成小孩一样宠爱。' },
          { s: 'nar', t: '你吹灭蜡烛的一瞬间，礼堂的灯一盏一盏亮起来。梦还在继续。' },
          { s: 'byeori', t: '目标达成！舞台幕布后面就是下一关——Jiwoo 在等的「灯油与火焰」。信使要下冥界啦。' },
        ],
      },

      /* ── 关 2 · Kerosene ── */
      'l2.intro': {
        type: 'intro',
        trigger: 'npc:jiwoo',
        once: true,
        lines: [
          { s: 'jiwoo', t: 'NSWER！！这边这边！呼——这里黑得我心慌，我的愿望之星掉进灯柱迷宫了。' },
          { s: 'jiwoo', t: '我可是信使 Jiwoo！信使的使命，就是带着光深入最黑的地方，把春天带回来。' },
          { s: 'jiwoo', t: '这里没有蜡烛，只有灯柱。灯柱要点燃，需要灯油，灯油罐就散落在路上。' },
          { s: 'jiwoo', t: '捧起灯油走到灯柱旁，就能把它点燃！每点一根灯柱，就有一扇门会打开。' },
        ],
        next: 'l2.jiwoo.hint',
      },
      'l2.jiwoo.hint': {
        type: 'hint', trigger: 'npc:jiwoo', once: false,
        lines: [
          { s: 'jiwoo', t: '一罐灯油只能点一根灯柱，别拿错方向啦！' },
          { s: 'jiwoo', t: '最暗的角落……好像藏着什么。勇敢一点，去看看嘛？' },
        ],
      },
      'l2.clear': {
        type: 'clear', trigger: 'clear:2', scopeId: 2, entry: true, once: true,
        lines: [
          { s: 'jiwoo', t: '全——部——点——燃！哇，火焰像生日蜡烛一样好看！' },
          { s: 'byeori', t: '下一站是霓虹态度街头，Kyujin 的地盘。她说话有点酷，别被吓到哦？' },
        ],
      },

      /* ── 关 3 · RudE TaLK ── */
      'l3.intro': {
        type: 'intro',
        trigger: 'npc:kyujin',
        once: true,
        lines: [
          { s: 'kyujin', t: '来了啊。欢迎来到我的街区。规则只有一条——别怂。' },
          { s: 'kyujin', t: '这里的门都是「单向门」，走进去就回不了头。看地上的霓虹箭头，那是指路牌。' },
          { s: 'kyujin', t: '说出口的话没有回头路，就像这门。所以，对那些乱嚼舌根的人，我从来只回一句——So what? ' },
          { s: 'kyujin', t: '想抄近路？先过「态度检查」再说。答对了走捷径，答错了……绕远路慢慢磨吧。' },
        ],
        next: 'l3.hint',
      },
      'l3.dj.check': {
        type: 'check',
        trigger: 'npc:dj',
        once: false,
        lines: [{ s: 'dj', t: '哟，新来的。想从这条捷径过？回答我——这条街最酷的人是谁？' }],
        options: [
          { label: '「Kyujin。」', goto: 'l3.dj.right' },
          { label: '「我自己。」', goto: 'l3.dj.wrong' },
        ],
      },
      'l3.dj.right': {
        type: 'check', trigger: 'npc:dj', once: false,
        lines: [{ s: 'dj', t: '会说话。过吧，捷径为你开。' }],
      },
      'l3.dj.wrong': {
        type: 'check', trigger: 'npc:dj', once: false,
        lines: [{ s: 'dj', t: '哈！有胆量，但没门。远路在那边，跑起来！' }],
      },
      'l3.hint': {
        type: 'hint', trigger: 'npc:kyujin', once: false,
        lines: [{ s: 'kyujin', t: '箭头不会骗人。看不懂的时候，就顺着箭头走一遍。' }],
      },
      'l3.clear': {
        type: 'clear', trigger: 'clear:3', scopeId: 3, entry: true, once: true,
        lines: [
          { s: 'kyujin', t: '行啊，有点东西。霓虹今晚为你亮灯。' },
          { s: 'byeori', t: '下一站是月夜湖畔，Lily 和 Haewon 在等。记得小声一点，月亮在听。' },
        ],
      },

      /* ── 关 4 · Sing to the Moon（小分队：Lily + Haewon） ── */
      'l4.intro': {
        type: 'intro',
        trigger: 'npc:lily',
        once: true,
        lines: [
          { s: 'lily', t: '嘘——听，湖水在唱歌。今晚的月亮很满，满得能托起浮桥。' },
          { s: 'lily', t: '这里的月亮管着水位：按下「月相开关」，水涨桥现，水落浅滩露。' },
          { s: 'haewon', t: '就像我每年一半时间陪她去冥界、一半时间看她回人间——月亮从不为难赶路的人。' },
          { s: 'haewon', t: '掉进水里也没关系，会送你回岸边——但星星得重跑一趟，所以，看准再走！' },
        ],
        next: 'l4.lily.hint',
      },
      'l4.lily.hint': {
        type: 'hint', trigger: 'npc:lily', once: false,
        lines: [{ s: 'lily', t: '涨水走浮桥，退水走浅滩。春天来了又走，路也是一样，会回来的。' }],
      },
      'l4.haewon.hint': {
        type: 'hint', trigger: 'npc:haewon', once: false,
        lines: [{ s: 'haewon', t: '月亮不会偏心，它照亮每一条正确的路。' }],
      },
      'l4.npc.sullyoon': {
        type: 'npc', trigger: 'npc:sullyoon', once: true,
        lines: [{ s: 'sullyoon', t: '月光落进湖里，像一面不会碎的镜子。' }],
      },
      'l4.npc.bae': {
        type: 'npc', trigger: 'npc:bae', once: true,
        lines: [{ s: 'bae', t: '这湖边好适合种花！春天到了，什么都会开！' }],
      },
      'l4.npc.kyujin': {
        type: 'npc', trigger: 'npc:kyujin', once: true,
        lines: [{ s: 'kyujin', t: '……水声，还不赖。' }],
      },
      'l4.npc.jiwoo': {
        type: 'npc', trigger: 'npc:jiwoo', once: true,
        lines: [{ s: 'jiwoo', t: '我可以对着湖面喊一整晚！哦——！' }],
      },
      'l4.clear': {
        type: 'clear', trigger: 'clear:4', scopeId: 4, entry: true, once: true,
        lines: [
          { s: 'lily', t: '月亮听了你的脚步。无论去往多深的夜，明天见——我们总会在春天重逢。' },
          { s: 'haewon', t: '四颗星星齐了！湖心传送门，出发！' },
          { s: 'byeori', t: '下一站会有点热——Sullyoon 和 Bae 的沙漠绿洲，记得带清凉的心情。' },
        ],
      },

      /* ── 关 5 · Hot 'n Unbothered（小分队：Sullyoon + Bae） ── */
      'l5.intro': {
        type: 'intro',
        trigger: 'npc:bae',
        once: true,
        lines: [
          { s: 'bae', t: '好——热——！这里本来该是丰收的田野，愿望之星一散，大地就荒成沙漠了。' },
          { s: 'bae', t: '不过没关系，绿洲就是大地的笑意。看右上角那条「清凉条」！它一直在往下掉。' },
          { s: 'sullyoon', t: '绿洲能恢复清凉；对话的时候计时会暂停，放心聊天。' },
          { s: 'sullyoon', t: '五颗星星藏在迷宫深处。清凉条见底前找到它们，冲进传送门。' },
          { s: 'bae', t: '仙人掌的影子下面，也稍微凉快一点哦——沙漠里每一片荫凉都是礼物！' },
        ],
        next: 'l5.bae.hint',
      },
      'l5.sullyoon.hint': {
        type: 'hint', trigger: 'npc:sullyoon', once: false,
        lines: [{ s: 'sullyoon', t: '心里不慌，汗就白流一半。先找绿洲，再找星星。' }],
      },
      'l5.bae.hint': {
        type: 'hint', trigger: 'npc:bae', once: false,
        lines: [{ s: 'bae', t: '玫瑰能在最干的地方开花，你也能找到路。冲就完了！' }],
      },
      'l5.npc.lily': {
        type: 'npc', trigger: 'npc:lily', once: true,
        lines: [{ s: 'lily', t: '多喝水，NSWER。绿洲就在前面，春天也是。' }],
      },
      'l5.npc.haewon': {
        type: 'npc', trigger: 'npc:haewon', once: true,
        lines: [{ s: 'haewon', t: '这太阳晒得连冥王都想度假了。' }],
      },
      'l5.npc.jiwoo': {
        type: 'npc', trigger: 'npc:jiwoo', once: true,
        lines: [{ s: 'jiwoo', t: '信使 Jiwoo 全速前进——咻！影子都追不上我！' }],
      },
      'l5.npc.kyujin': {
        type: 'npc', trigger: 'npc:kyujin', once: true,
        lines: [{ s: 'kyujin', t: '热是热，但没在怕的。' }],
      },
      'l5.clear': {
        type: 'clear', trigger: 'clear:5', scopeId: 5, entry: true, once: true,
        lines: [
          { s: 'sullyoon', t: '周遭再喧闹，我们从头到尾都没被打扰呢。Hot \'n unbothered，就是这个意思。' },
          { s: 'bae', t: '五颗星星到手！大地又开花了——看，玫瑰。开玩笑啦，传送门在滴水，快出发！' },
          { s: 'byeori', t: '最后一站：疾风终章。Jiwoo 和 Kyujin 在山顶等你。' },
        ],
      },

      /* ── 关 6 · WHIP 与结局（小分队：Jiwoo + Kyujin） ── */
      'l6.intro': {
        type: 'intro',
        trigger: 'npc:lily',
        once: true,
        lines: [
          { s: 'lily', t: 'NSWER，最后一关。山顶的许愿蛋糕，正在等 25 颗星星全部归位。' },
          { s: 'jiwoo', t: '咻——！信使 Jiwoo 已经把风都叫来了！风会推着你走，别跟它较劲，顺着风借力。' },
          { s: 'kyujin', t: '风车开关会改变风向。天空借给你的风，要自己调好方向。' },
          { s: 'haewon', t: '把前面学会的一切都用上吧——灯、门、月相、态度，一样都别丢。' },
          { s: 'byeori', t: '加油，NSWER！응답하라 NSWER！' },
        ],
        next: 'l6.hint',
      },
      'l6.hint': {
        type: 'hint', trigger: 'npc:kyujin', once: false,
        lines: [{ s: 'kyujin', t: '风从哪边来，就往哪边借力。逆风跑，只会被吹回原地。' }],
      },
      'l6.end': {
        type: 'cutscene', trigger: 'cake', scopeId: 6, once: true,
        lines: [
          { s: 'nar', t: '25 颗愿望之星，全部到齐。许愿蛋糕被逐层点亮——25 支蜡烛，25 个心愿。' },
          { s: 'lily', t: '那么——一起许愿吧。春天会回来，我们永远在彼此的生日里。응답하라 NSWER！' },
          { s: 'all', t: '긴 소원을 부릅니다——（许下长长的愿望——）' },
          { s: 'nar', t: '灵感之泉重新涌流，大地回春，沙漠开出玫瑰，泉水漫过梦境，化作一条星光河。' },
          { s: 'nar', t: '飞马掠过紫罗兰的天空，载着你飞向黎明的方向……' },
          { s: 'byeori', t: '你的生日愿望，缪斯们会替你好好保管的。晚安，NSWER——明天见。' },
          { s: 'nar', t: '——献给每一位 NSWER。感谢游玩 MIXXTOPIA！' },
        ],
      },

      /* ── 黑羊彩蛋（每关一只，互动计数 sheep +1；集齐 6 句追加结局画面） ── */
      'l1.sheep': {
        type: 'sheep', trigger: 'sheep:sheep1', once: true,
        lines: [{ s: 'sheep', t: '第一个愿望，是让小时候的生日会，永远不散场。' }],
      },
      'l2.sheep': {
        type: 'sheep', trigger: 'sheep:sheep2', once: true,
        lines: [{ s: 'sheep', t: '火焰记得每一滴灯油的名字。' }],
      },
      'l3.sheep': {
        type: 'sheep', trigger: 'sheep:sheep3', once: true,
        lines: [{ s: 'sheep', t: '最酷的态度，是敢承认自己走错了路。' }],
      },
      'l4.sheep': {
        type: 'sheep', trigger: 'sheep:sheep4', once: true,
        lines: [{ s: 'sheep', t: '月亮从不催促夜路的人。' }],
      },
      'l5.sheep': {
        type: 'sheep', trigger: 'sheep:sheep5', once: true,
        lines: [{ s: 'sheep', t: '真正的清凉，是心里不慌。' }],
      },
      'l6.sheep': {
        type: 'sheep', trigger: 'sheep:sheep6', once: true,
        lines: [{ s: 'sheep', t: '风会把你吹向该去的地方。' }],
      },
    },

    // 稳定通道默认键；beta/preview 由 js/main.js 在运行时追加 .beta / .preview
    saveKey: 'mixxtopia.save.v1',
  };

  root.GAME = GAME;
})(typeof window !== 'undefined' ? window : globalThis);
