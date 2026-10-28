/**
 * js/data.js —— 关卡数据：6 关地图 + 对话 + 谜题（数据驱动）
 * 所属任务：Issue #11 地图数据（关 1 已接入，关 2–6 待制作） / Issue #12 对话文案（已接入）。
 *
 * 数据格式规格见 docs/GAME_DESIGN.md §11（GAME 全局对象：
 * meta / scenes / avatarPresets / characters / levels / dialogue / saveKey）。
 * 头像固定选项集（avatarPresets）供账户设置（#44）使用，白名单在前端维护。
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

    /* 独立场景：新游戏播放 p0，结束后载入第一关；不纳入 levels 与星数。 */
    scenes: {
      p0: {
        title: '生日夜的房间',
        background: 'assets/scenes/p0-bedroom.png',
        portraits: false, // 序章聚焦场景；Byeori 立绘尚未制作
      },
    },

    /* 账户头像固定选项集（Issue #44）：昵称/头像读写 profiles 表，白名单放在前端。
       数据库只校验 id 格式（^[a-z0-9][a-z0-9-]{0,31}$，见 supabase/migrations/0001_init.sql），
       所以后续新增头像只需在这里追加一条（id + 显示名 + 占位色），无需数据库迁移；
       账户设置界面按本数组动态渲染选项，未知 id 在渲染时回退默认头像 muse-1。
       美术素材（#13）就位后，可给每条追加 art 字段并在渲染时换用图片。 */
    avatarPresets: [
      { id: 'muse-1', name: 'Lily', color: '#7FB8E6', art: 'assets/avatars/muse-portraits-v1.png', portraitCell: [0, 0] },
      { id: 'muse-2', name: 'Haewon', color: '#FFB14E', art: 'assets/avatars/muse-portraits-v1.png', portraitCell: [1, 0] },
      { id: 'muse-3', name: 'Sullyoon', color: '#B49BFF', art: 'assets/avatars/muse-portraits-v1.png', portraitCell: [2, 0] },
      { id: 'muse-4', name: 'Bae', color: '#FF7BA9', art: 'assets/avatars/muse-portraits-v1.png', portraitCell: [0, 1] },
      { id: 'muse-5', name: 'Jiwoo', color: '#FFE066', art: 'assets/avatars/muse-portraits-v1.png', portraitCell: [1, 1] },
      { id: 'muse-6', name: 'Kyujin', color: '#5EE6B8', art: 'assets/avatars/muse-portraits-v1.png', portraitCell: [2, 1] },
    ],

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

    /* 关 1：礼堂 / 舞台 / 后台化妆间，实体坐标统一，区域入口仅移动玩家。 */
    levels: [
      {
        "id": 1,
        "title": "Birthday Wish",
        "region": "海洋生日会 · 舞台与化妆间",
        "tileset": "birthday",
        "palette": {
          "bg": "#1B2847",
          "cream": "#C69A6F",
          "pink": "#A97856",
          "mint": "#B8E0D2",
          "gold": "#E4BD8B"
        },
        "bgm": "l1_candle",
        "portraits": false,
        "starCount": 3,
        "combat": false,
        "map": {
          "w": 68,
          "h": 28,
          "rows": [
            "####################################################################",
            "#FFFFFFF·###########################################################",
            "#FFFFFFF·###########################################################",
            "#······F·###########################################################",
            "#·FFF··F·#······················####################################",
            "#·FFF··F·#··FFF·FFFF···FFF·FF······#################################",
            "#······F·#··FFF·FFFF···FFF·FF······######········FFFFFFFFFFFFFFF···#",
            "######·###·························######·FF·FF··FFFFFFFFFFFFFFF···#",
            "#······································##·FF·····FFFFFFFFFFFFFFF···#",
            "#······································##·········F··F··F··F··F····#",
            "#······································##·FF·F·····················#",
            "#·FFFF····························FFFF·##··························#",
            "#·FFFF·····FF·FF·FF····FFFF·FF····FFFF·##·········F··F··F··F··F····#",
            "#·FFFF·····FF·FF·FF····FFFF·FF····FFFF·##········FFFFFFFFFFFFFFF···#",
            "#··········FF·FF·FF····FFFF·FF·········##········FFFFFFFFFFFFFFF···#",
            "#··········FF·FF·FF····FFFF·FF·········##········FFFFFFFFFFFFFFF···#",
            "#·································FFFF·##········FFFFFFFFFFFFFFF···#",
            "#·FFFF·····FF·FF·FF····FFFF·FF····FFFF·##········FFFFFFFFFFFFFFF···#",
            "#·FFFF·····FF·FF·FF····FFFF·FF····FFFF·##········FFFFFFFFFFFFFFF···#",
            "#·FFFF·····FF·FF·FF····FFFF·FF····FFFF·##·········F··F··F··F··F····#",
            "#·FFFF·····FF·FF·FF····FFFF·FF····FFFF·##··························#",
            "#······································##··························#",
            "#······································##·········F··F··F··F··F····#",
            "#············FFFF······················##·FFFFF··FFFFFFFFFFFFFFF···#",
            "##################····#FF################·FFFFF··FFFFFFFFFFFFFFF···#",
            "##################····###################·FFF····FFFFFFFFFFFFFFF···#",
            "##################····###################··························#",
            "####################################################################"
          ],
          "legend": {
            "#": "wall",
            "·": "floor",
            "F": "wall",
            "M": "wall"
          },
          "styles": {
            "F": "floor",
            "M": "panel"
          }
        },
        "entities": [
          {
            "type": "spawn",
            "x": 19,
            "y": 25
          },
          {
            "type": "npc",
            "id": "lily",
            "x": 21,
            "y": 23,
            "room": "hall",
            "dialogue": "l1.intro",
            "sprite": 0,
            "age": "adult",
            "museStyle": "lily",
            "fixed": true
          },
          {
            "type": "npc",
            "id": "haewon",
            "x": 18,
            "y": 7,
            "room": "hall",
            "dialogue": "l1.npc.haewon",
            "spriteOffsetY": -1.6,
            "sprite": 0,
            "age": "adult",
            "museStyle": "haewon",
            "fixed": true,
            "performance": "drums"
          },
          {
            "type": "npc",
            "id": "sullyoon",
            "x": 32,
            "y": 12,
            "room": "hall",
            "dialogue": "l1.npc.sullyoon",
            "sprite": 3,
            "age": "adult",
            "museStyle": "sullyoon",
            "fixed": true
          },
          {
            "type": "npc",
            "id": "bae",
            "x": 8,
            "y": 20,
            "room": "hall",
            "dialogue": "l1.npc.bae",
            "sprite": 2,
            "age": "adult",
            "museStyle": "bae",
            "fixed": true
          },
          {
            "type": "npc",
            "id": "jiwoo",
            "x": 30,
            "y": 16,
            "room": "hall",
            "dialogue": "l1.npc.jiwoo",
            "sprite": 1,
            "age": "adult",
            "museStyle": "jiwoo",
            "fixed": true
          },
          {
            "type": "npc",
            "id": "kyujin",
            "x": 23,
            "y": 7,
            "room": "hall",
            "dialogue": "l1.npc.kyujin",
            "sprite": 1,
            "age": "adult",
            "museStyle": "kyujin",
            "fixed": true,
            "performance": "guitar"
          },
          {
            "type": "sheep",
            "id": "sheep1",
            "x": 9,
            "y": 22,
            "dialogue": "l1.sheep"
          },
          {
            "type": "star",
            "id": "s1",
            "x": 7,
            "y": 21,
            "requiresDialogue": [
              "l1.rings.complete"
            ]
          },
          {
            "type": "star",
            "id": "s2",
            "x": 4,
            "y": 6
          },
          {
            "type": "door",
            "id": "gift-door",
            "x": 6,
            "y": 7,
            "open": false,
            "label": "杂物间 · E 开门"
          },
          {
            "type": "roomdoor",
            "id": "to-backstage",
            "x": 34,
            "y": 5,
            "to": {
              "x": 65,
              "y": 20
            },
            "label": "右侧幕布后 · 化妆间",
            "visual": "curtain",
            "fadeIn": true,
            "enterFrom": "west",
            "arrivalNode": "l1.backstage.arrived"
          },
          {
            "type": "star",
            "id": "s3",
            "x": 47,
            "y": 16,
            "requiresDialogue": [
              "l1.backstage.lily",
              "l1.backstage.sullyoon",
              "l1.backstage.byeori"
            ]
          },
          {
            "type": "portal",
            "x": 42,
            "y": 16,
            "to": 2,
            "requiresDialogue": [
              "l1.backstage.lily",
              "l1.backstage.sullyoon",
              "l1.backstage.byeori"
            ],
            "facing": "east"
          },
          {
            "type": "npc",
            "id": "lily",
            "x": 43,
            "y": 12,
            "room": "backstage",
            "dialogue": "l1.backstage.lily",
            "sprite": 0,
            "age": "adult",
            "museStyle": "lily",
            "fixed": true
          },
          {
            "type": "npc",
            "id": "haewon",
            "x": 45,
            "y": 12,
            "room": "backstage",
            "dialogue": "l1.backstage.haewon",
            "sprite": 0,
            "age": "adult",
            "museStyle": "haewon",
            "fixed": true
          },
          {
            "type": "npc",
            "id": "sullyoon",
            "x": 47,
            "y": 12,
            "room": "backstage",
            "dialogue": "l1.backstage.sullyoon",
            "sprite": 3,
            "age": "adult",
            "museStyle": "sullyoon",
            "fixed": true
          },
          {
            "type": "npc",
            "id": "bae",
            "x": 43,
            "y": 19,
            "room": "backstage",
            "dialogue": "l1.backstage.bae",
            "sprite": 2,
            "age": "adult",
            "museStyle": "bae",
            "fixed": true
          },
          {
            "type": "npc",
            "id": "jiwoo",
            "x": 45,
            "y": 19,
            "room": "backstage",
            "dialogue": "l1.backstage.jiwoo",
            "sprite": 1,
            "age": "adult",
            "museStyle": "jiwoo",
            "fixed": true
          },
          {
            "type": "npc",
            "id": "kyujin",
            "x": 47,
            "y": 19,
            "room": "backstage",
            "dialogue": "l1.backstage.kyujin",
            "sprite": 1,
            "age": "adult",
            "museStyle": "kyujin",
            "fixed": true
          },
          {
            "type": "npc",
            "id": "byeori",
            "x": 45,
            "y": 16,
            "room": "backstage",
            "dialogue": "l1.backstage.byeori",
            "sprite": 0,
            "age": "adult"
          },
          {
            "type": "record",
            "id": "birthday-record",
            "x": 6,
            "y": 6,
            "dialogue": "l1.record.take",
            "requiresStars": [
              "s1",
              "s2"
            ],
            "requiresDialogue": [
              "l1.npc.lily",
              "l1.npc.haewon",
              "l1.npc.sullyoon",
              "l1.npc.bae",
              "l1.npc.jiwoo",
              "l1.npc.kyujin"
            ]
          },
          {
            "type": "gramophone",
            "id": "stage-music",
            "x": 28,
            "y": 7,
            "dialogue": "l1.music.play",
            "recordNode": "l1.record.take",
            "requiresStars": [
              "s1",
              "s2"
            ],
            "requiresDialogue": [
              "l1.npc.lily",
              "l1.npc.haewon",
              "l1.npc.sullyoon",
              "l1.npc.bae",
              "l1.npc.jiwoo",
              "l1.npc.kyujin"
            ]
          },
          {
            "type": "gate",
            "id": "backstage-gate",
            "requiresStars": [
              "s1",
              "s2"
            ],
            "x": 34,
            "y": 5,
            "open": false,
            "requiresDialogue": [
              "l1.music.play"
            ],
            "visual": "curtain"
          },
          {
            "type": "trigger",
            "id": "music-ready",
            "skipIfDialogue": [
              "l1.record.take",
              "l1.music.play"
            ],
            "x": 25,
            "y": 8,
            "rect": {
              "x": 27,
              "y": 7,
              "w": 3,
              "h": 2
            },
            "dialogue": "l1.music.ready",
            "requiresStars": [
              "s1",
              "s2"
            ],
            "requiresDialogue": [
              "l1.npc.lily",
              "l1.npc.haewon",
              "l1.npc.sullyoon",
              "l1.npc.bae",
              "l1.npc.jiwoo",
              "l1.npc.kyujin"
            ]
          },
          {
            "type": "minigame",
            "id": "ring-toss",
            "x": 6,
            "y": 21,
            "room": "hall",
            "dialogue": "l1.rings.complete"
          },
          {
            "type": "guest",
            "room": "hall",
            "age": "child",
            "id": "child-blue",
            "x": 9,
            "y": 17,
            "sprite": 4,
            "path": [
              [
                9,
                17
              ],
              [
                9,
                20
              ]
            ],
            "lines": [
              "我想把圈圈套到小鲸鱼上！"
            ],
            "motionStyle": "childBlue"
          },
          {
            "type": "guest",
            "room": "hall",
            "age": "child",
            "id": "child-pink",
            "x": 8,
            "y": 22,
            "sprite": 5,
            "lines": [
              "套中月亮以后，再试试星星吧。"
            ]
          },
          {
            "type": "guest",
            "room": "hall",
            "age": "child",
            "id": "child-yellow",
            "x": 32,
            "y": 17,
            "sprite": 6,
            "path": [
              [
                32,
                17
              ],
              [
                32,
                21
              ]
            ],
            "lines": [
              "钓到的鱼像糖果一样！"
            ],
            "motionStyle": "childYellow"
          },
          {
            "type": "guest",
            "room": "hall",
            "age": "child",
            "id": "child-mint",
            "x": 34,
            "y": 22,
            "sprite": 7,
            "lines": [
              "老师说，今天谁都可以许愿。"
            ]
          },
          {
            "type": "guest",
            "room": "hall",
            "age": "child",
            "id": "child-walk",
            "x": 15,
            "y": 22,
            "sprite": 5,
            "path": [
              [
                15,
                22
              ],
              [
                17,
                22
              ]
            ],
            "lines": [
              "地上的彩带像小小的海浪。"
            ],
            "motionStyle": "childPink"
          },
          {
            "type": "guest",
            "room": "hall",
            "age": "adult",
            "id": "teacher",
            "x": 31,
            "y": 13,
            "sprite": 3,
            "lines": [
              "慢慢玩就好，小朋友们都会给你加油。"
            ]
          },
          {
            "type": "guest",
            "room": "hall",
            "age": "adult",
            "id": "teacher-blue",
            "x": 25,
            "y": 22,
            "sprite": 0,
            "motionStyle": "adultBlue",
            "lines": [
              "欢迎来玩！慢慢走，别踩到散落的彩带啦。"
            ]
          },
          {
            "type": "guest",
            "room": "hall",
            "age": "adult",
            "id": "parent-mustard",
            "x": 9,
            "y": 12,
            "sprite": 2,
            "motionStyle": "parent",
            "lines": [
              "小朋友们都在等生日会开始。先去和台上的姐姐们打个招呼吧。"
            ]
          },
          {
            "type": "guest",
            "room": "hall",
            "age": "adult",
            "id": "parent-violet",
            "x": 30,
            "y": 22,
            "sprite": 1,
            "lines": [
              "每次听见生日歌，我也会想起小时候。"
            ]
          }
        ],
        "sceneryAssets": {
          "classroom": "assets/scenes/level1/classroom-props-v1.png",
          "ocean": "assets/scenes/level1/ocean-party-v1.png",
          "mural": "assets/scenes/level1/whale-mural-v1.png",
          "backstage": "assets/scenes/level1/backstage-props-v1.png",
          "portal": "assets/scenes/level1/star-portal-v1.png",
          "seating": "assets/scenes/level1/seating-entrance-v1.png",
          "curtains": "assets/scenes/level1/stage-curtains-v1.png",
          "games": "assets/scenes/level1/party-games-v1.png",
          "fitting": "assets/scenes/level1/dressing-music-v1.png",
          "instruments": "assets/scenes/level1/stage-instruments-v1.png",
          "cover": "assets/scenes/level1/strange-muse-cover.jpg",
          "vanityModules": "assets/scenes/level1/vanity-modules-v1.png",
          "portalEast": "assets/scenes/level1/star-portal-east-v1.png",
          "birthdayHall": "assets/scenes/level1/birthday-hall-v2.png",
          "guests": "assets/scenes/level1/party-guests-v2.png",
          "museCostumes": "assets/scenes/level1/muse-costumes-v4.png",
          "adultBlue": "assets/scenes/level1/party-adult-walk-v3.png",
          "childBlue": "assets/scenes/level1/party-child-walk-v3.png",
          "parent": "assets/scenes/level1/party-parent-walk-v3.png",
          "childPink": "assets/scenes/level1/party-pink-walk-v3.png",
          "childYellow": "assets/scenes/level1/party-yellow-walk-v3.png"
        },
        "groundDecorations": [],
        "decorations": [
          {
            "kind": "vanity",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              0,
              0,
              512,
              512
            ],
            "x": 49,
            "y": 6,
            "w": 3,
            "h": 3,
            "facing": "south",
            "stations": 1,
            "collision": {
              "x": 49,
              "y": 6,
              "w": 3,
              "h": 3
            }
          },
          {
            "kind": "vanityStool",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              1156,
              202,
              233,
              280
            ],
            "x": 50,
            "y": 8.798283261802576,
            "w": 1,
            "h": 1.201716738197425,
            "collision": {
              "x": 50,
              "y": 9,
              "w": 1,
              "h": 1
            }
          },
          {
            "kind": "vanity",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              0,
              0,
              512,
              512
            ],
            "x": 52,
            "y": 6,
            "w": 3,
            "h": 3,
            "facing": "south",
            "stations": 1,
            "collision": {
              "x": 52,
              "y": 6,
              "w": 3,
              "h": 3
            }
          },
          {
            "kind": "vanityStool",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              1156,
              202,
              233,
              280
            ],
            "x": 53,
            "y": 8.798283261802576,
            "w": 1,
            "h": 1.201716738197425,
            "collision": {
              "x": 53,
              "y": 9,
              "w": 1,
              "h": 1
            }
          },
          {
            "kind": "vanity",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              0,
              0,
              512,
              512
            ],
            "x": 55,
            "y": 6,
            "w": 3,
            "h": 3,
            "facing": "south",
            "stations": 1,
            "collision": {
              "x": 55,
              "y": 6,
              "w": 3,
              "h": 3
            }
          },
          {
            "kind": "vanityStool",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              1156,
              202,
              233,
              280
            ],
            "x": 56,
            "y": 8.798283261802576,
            "w": 1,
            "h": 1.201716738197425,
            "collision": {
              "x": 56,
              "y": 9,
              "w": 1,
              "h": 1
            }
          },
          {
            "kind": "vanity",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              0,
              0,
              512,
              512
            ],
            "x": 58,
            "y": 6,
            "w": 3,
            "h": 3,
            "facing": "south",
            "stations": 1,
            "collision": {
              "x": 58,
              "y": 6,
              "w": 3,
              "h": 3
            }
          },
          {
            "kind": "vanityStool",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              1156,
              202,
              233,
              280
            ],
            "x": 59,
            "y": 8.798283261802576,
            "w": 1,
            "h": 1.201716738197425,
            "collision": {
              "x": 59,
              "y": 9,
              "w": 1,
              "h": 1
            }
          },
          {
            "kind": "vanity",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              0,
              0,
              512,
              512
            ],
            "x": 61,
            "y": 6,
            "w": 3,
            "h": 3,
            "facing": "south",
            "stations": 1,
            "collision": {
              "x": 61,
              "y": 6,
              "w": 3,
              "h": 3
            }
          },
          {
            "kind": "vanityStool",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              1156,
              202,
              233,
              280
            ],
            "x": 62,
            "y": 8.798283261802576,
            "w": 1,
            "h": 1.201716738197425,
            "collision": {
              "x": 62,
              "y": 9,
              "w": 1,
              "h": 1
            }
          },
          {
            "kind": "vanity",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              512,
              0,
              512,
              512
            ],
            "x": 49,
            "y": 13,
            "w": 3,
            "h": 3,
            "facing": "north",
            "stations": 1,
            "collision": {
              "x": 49,
              "y": 13,
              "w": 3,
              "h": 3
            }
          },
          {
            "kind": "vanityStool",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              1156,
              202,
              233,
              280
            ],
            "x": 50,
            "y": 11.798283261802576,
            "w": 1,
            "h": 1.201716738197425,
            "collision": {
              "x": 50,
              "y": 12,
              "w": 1,
              "h": 1
            }
          },
          {
            "kind": "vanity",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              512,
              0,
              512,
              512
            ],
            "x": 52,
            "y": 13,
            "w": 3,
            "h": 3,
            "facing": "north",
            "stations": 1,
            "collision": {
              "x": 52,
              "y": 13,
              "w": 3,
              "h": 3
            }
          },
          {
            "kind": "vanityStool",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              1156,
              202,
              233,
              280
            ],
            "x": 53,
            "y": 11.798283261802576,
            "w": 1,
            "h": 1.201716738197425,
            "collision": {
              "x": 53,
              "y": 12,
              "w": 1,
              "h": 1
            }
          },
          {
            "kind": "vanity",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              512,
              0,
              512,
              512
            ],
            "x": 55,
            "y": 13,
            "w": 3,
            "h": 3,
            "facing": "north",
            "stations": 1,
            "collision": {
              "x": 55,
              "y": 13,
              "w": 3,
              "h": 3
            }
          },
          {
            "kind": "vanityStool",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              1156,
              202,
              233,
              280
            ],
            "x": 56,
            "y": 11.798283261802576,
            "w": 1,
            "h": 1.201716738197425,
            "collision": {
              "x": 56,
              "y": 12,
              "w": 1,
              "h": 1
            }
          },
          {
            "kind": "vanity",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              512,
              0,
              512,
              512
            ],
            "x": 58,
            "y": 13,
            "w": 3,
            "h": 3,
            "facing": "north",
            "stations": 1,
            "collision": {
              "x": 58,
              "y": 13,
              "w": 3,
              "h": 3
            }
          },
          {
            "kind": "vanityStool",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              1156,
              202,
              233,
              280
            ],
            "x": 59,
            "y": 11.798283261802576,
            "w": 1,
            "h": 1.201716738197425,
            "collision": {
              "x": 59,
              "y": 12,
              "w": 1,
              "h": 1
            }
          },
          {
            "kind": "vanity",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              512,
              0,
              512,
              512
            ],
            "x": 61,
            "y": 13,
            "w": 3,
            "h": 3,
            "facing": "north",
            "stations": 1,
            "collision": {
              "x": 61,
              "y": 13,
              "w": 3,
              "h": 3
            }
          },
          {
            "kind": "vanityStool",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              1156,
              202,
              233,
              280
            ],
            "x": 62,
            "y": 11.798283261802576,
            "w": 1,
            "h": 1.201716738197425,
            "collision": {
              "x": 62,
              "y": 12,
              "w": 1,
              "h": 1
            }
          },
          {
            "kind": "vanity",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              0,
              0,
              512,
              512
            ],
            "x": 49,
            "y": 16,
            "w": 3,
            "h": 3,
            "facing": "south",
            "stations": 1,
            "collision": {
              "x": 49,
              "y": 16,
              "w": 3,
              "h": 3
            }
          },
          {
            "kind": "vanityStool",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              1156,
              202,
              233,
              280
            ],
            "x": 50,
            "y": 18.798283261802574,
            "w": 1,
            "h": 1.201716738197425,
            "collision": {
              "x": 50,
              "y": 19,
              "w": 1,
              "h": 1
            }
          },
          {
            "kind": "vanity",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              0,
              0,
              512,
              512
            ],
            "x": 52,
            "y": 16,
            "w": 3,
            "h": 3,
            "facing": "south",
            "stations": 1,
            "collision": {
              "x": 52,
              "y": 16,
              "w": 3,
              "h": 3
            }
          },
          {
            "kind": "vanityStool",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              1156,
              202,
              233,
              280
            ],
            "x": 53,
            "y": 18.798283261802574,
            "w": 1,
            "h": 1.201716738197425,
            "collision": {
              "x": 53,
              "y": 19,
              "w": 1,
              "h": 1
            }
          },
          {
            "kind": "vanity",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              0,
              0,
              512,
              512
            ],
            "x": 55,
            "y": 16,
            "w": 3,
            "h": 3,
            "facing": "south",
            "stations": 1,
            "collision": {
              "x": 55,
              "y": 16,
              "w": 3,
              "h": 3
            }
          },
          {
            "kind": "vanityStool",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              1156,
              202,
              233,
              280
            ],
            "x": 56,
            "y": 18.798283261802574,
            "w": 1,
            "h": 1.201716738197425,
            "collision": {
              "x": 56,
              "y": 19,
              "w": 1,
              "h": 1
            }
          },
          {
            "kind": "vanity",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              0,
              0,
              512,
              512
            ],
            "x": 58,
            "y": 16,
            "w": 3,
            "h": 3,
            "facing": "south",
            "stations": 1,
            "collision": {
              "x": 58,
              "y": 16,
              "w": 3,
              "h": 3
            }
          },
          {
            "kind": "vanityStool",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              1156,
              202,
              233,
              280
            ],
            "x": 59,
            "y": 18.798283261802574,
            "w": 1,
            "h": 1.201716738197425,
            "collision": {
              "x": 59,
              "y": 19,
              "w": 1,
              "h": 1
            }
          },
          {
            "kind": "vanity",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              0,
              0,
              512,
              512
            ],
            "x": 61,
            "y": 16,
            "w": 3,
            "h": 3,
            "facing": "south",
            "stations": 1,
            "collision": {
              "x": 61,
              "y": 16,
              "w": 3,
              "h": 3
            }
          },
          {
            "kind": "vanityStool",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              1156,
              202,
              233,
              280
            ],
            "x": 62,
            "y": 18.798283261802574,
            "w": 1,
            "h": 1.201716738197425,
            "collision": {
              "x": 62,
              "y": 19,
              "w": 1,
              "h": 1
            }
          },
          {
            "kind": "vanity",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              512,
              0,
              512,
              512
            ],
            "x": 49,
            "y": 23,
            "w": 3,
            "h": 3,
            "facing": "north",
            "stations": 1,
            "collision": {
              "x": 49,
              "y": 23,
              "w": 3,
              "h": 3
            }
          },
          {
            "kind": "vanityStool",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              1156,
              202,
              233,
              280
            ],
            "x": 50,
            "y": 21.798283261802574,
            "w": 1,
            "h": 1.201716738197425,
            "collision": {
              "x": 50,
              "y": 22,
              "w": 1,
              "h": 1
            }
          },
          {
            "kind": "vanity",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              512,
              0,
              512,
              512
            ],
            "x": 52,
            "y": 23,
            "w": 3,
            "h": 3,
            "facing": "north",
            "stations": 1,
            "collision": {
              "x": 52,
              "y": 23,
              "w": 3,
              "h": 3
            }
          },
          {
            "kind": "vanityStool",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              1156,
              202,
              233,
              280
            ],
            "x": 53,
            "y": 21.798283261802574,
            "w": 1,
            "h": 1.201716738197425,
            "collision": {
              "x": 53,
              "y": 22,
              "w": 1,
              "h": 1
            }
          },
          {
            "kind": "vanity",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              512,
              0,
              512,
              512
            ],
            "x": 55,
            "y": 23,
            "w": 3,
            "h": 3,
            "facing": "north",
            "stations": 1,
            "collision": {
              "x": 55,
              "y": 23,
              "w": 3,
              "h": 3
            }
          },
          {
            "kind": "vanityStool",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              1156,
              202,
              233,
              280
            ],
            "x": 56,
            "y": 21.798283261802574,
            "w": 1,
            "h": 1.201716738197425,
            "collision": {
              "x": 56,
              "y": 22,
              "w": 1,
              "h": 1
            }
          },
          {
            "kind": "vanity",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              512,
              0,
              512,
              512
            ],
            "x": 58,
            "y": 23,
            "w": 3,
            "h": 3,
            "facing": "north",
            "stations": 1,
            "collision": {
              "x": 58,
              "y": 23,
              "w": 3,
              "h": 3
            }
          },
          {
            "kind": "vanityStool",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              1156,
              202,
              233,
              280
            ],
            "x": 59,
            "y": 21.798283261802574,
            "w": 1,
            "h": 1.201716738197425,
            "collision": {
              "x": 59,
              "y": 22,
              "w": 1,
              "h": 1
            }
          },
          {
            "kind": "vanity",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              512,
              0,
              512,
              512
            ],
            "x": 61,
            "y": 23,
            "w": 3,
            "h": 3,
            "facing": "north",
            "stations": 1,
            "collision": {
              "x": 61,
              "y": 23,
              "w": 3,
              "h": 3
            }
          },
          {
            "kind": "vanityStool",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              1156,
              202,
              233,
              280
            ],
            "x": 62,
            "y": 21.798283261802574,
            "w": 1,
            "h": 1.201716738197425,
            "collision": {
              "x": 62,
              "y": 22,
              "w": 1,
              "h": 1
            }
          },
          {
            "kind": "posters",
            "room": "backstage",
            "art": "fitting",
            "frame": [
              1024,
              0,
              170,
              512
            ],
            "x": 51,
            "y": 3.5,
            "w": 1.6,
            "h": 2.3
          },
          {
            "kind": "posters",
            "room": "backstage",
            "art": "fitting",
            "frame": [
              1194,
              0,
              170,
              512
            ],
            "x": 56,
            "y": 3.5,
            "w": 1.6,
            "h": 2.3
          },
          {
            "kind": "posters",
            "room": "backstage",
            "art": "fitting",
            "frame": [
              1364,
              0,
              170,
              512
            ],
            "x": 61,
            "y": 3.5,
            "w": 1.6,
            "h": 2.3
          },
          {
            "kind": "stageProps",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              512,
              512,
              512,
              512
            ],
            "x": 41,
            "y": 6,
            "w": 3.5,
            "h": 3.5,
            "collision": {
              "x": 42,
              "y": 7,
              "w": 2,
              "h": 2
            }
          },
          {
            "kind": "instrumentBench",
            "room": "backstage",
            "art": "instruments",
            "frame": [
              512,
              512,
              512,
              512
            ],
            "x": 44.5,
            "y": 6,
            "w": 2.8,
            "h": 2.8,
            "collision": {
              "x": 45,
              "y": 7,
              "w": 2,
              "h": 1
            }
          },
          {
            "kind": "storageTrunk",
            "room": "backstage",
            "art": "games",
            "frame": [
              1024,
              512,
              512,
              512
            ],
            "x": 41.5,
            "y": 9.2,
            "w": 3,
            "h": 2.8,
            "collision": {
              "x": 42,
              "y": 10,
              "w": 2,
              "h": 1
            }
          },
          {
            "kind": "makeupTrolley",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              0,
              512,
              512,
              512
            ],
            "x": 45,
            "y": 9.2,
            "w": 2,
            "h": 2.5,
            "collision": {
              "x": 45,
              "y": 10,
              "w": 1,
              "h": 1
            }
          },
          {
            "kind": "costumeRail",
            "room": "backstage",
            "art": "vanityModules",
            "frame": [
              1024,
              512,
              512,
              512
            ],
            "x": 41,
            "y": 22,
            "w": 4.5,
            "h": 4.5,
            "collision": {
              "x": 42,
              "y": 23,
              "w": 3,
              "h": 3
            }
          },
          {
            "kind": "guitars",
            "room": "backstage",
            "art": "instruments",
            "frame": [
              1024,
              0,
              512,
              512
            ],
            "x": 45,
            "y": 22,
            "w": 2.5,
            "h": 3.5,
            "collision": {
              "x": 45,
              "y": 23,
              "w": 2,
              "h": 2
            }
          },
          {
            "kind": "piano",
            "room": "hall",
            "baked": true,
            "x": 12,
            "y": 5,
            "w": 3,
            "h": 2,
            "collision": {
              "x": 12,
              "y": 5,
              "w": 3,
              "h": 2
            }
          },
          {
            "kind": "drums",
            "room": "hall",
            "baked": true,
            "x": 16,
            "y": 5,
            "w": 4,
            "h": 2,
            "collision": {
              "x": 16,
              "y": 5,
              "w": 4,
              "h": 2
            }
          },
          {
            "kind": "guitars",
            "room": "hall",
            "baked": true,
            "x": 23,
            "y": 5,
            "w": 3,
            "h": 2,
            "collision": {
              "x": 23,
              "y": 5,
              "w": 3,
              "h": 2
            }
          },
          {
            "kind": "gramophone",
            "room": "hall",
            "baked": true,
            "x": 27,
            "y": 5,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 27,
              "y": 5,
              "w": 2,
              "h": 2
            }
          },
          {
            "kind": "storageShelves",
            "room": "hall",
            "baked": true,
            "x": 1,
            "y": 1,
            "w": 7,
            "h": 2,
            "collision": {
              "x": 1,
              "y": 1,
              "w": 7,
              "h": 2
            }
          },
          {
            "kind": "spareChairs",
            "room": "hall",
            "baked": true,
            "x": 2,
            "y": 4,
            "w": 3,
            "h": 2,
            "collision": {
              "x": 2,
              "y": 4,
              "w": 3,
              "h": 2
            }
          },
          {
            "kind": "recordCabinet",
            "room": "hall",
            "baked": true,
            "x": 7,
            "y": 3,
            "w": 1,
            "h": 4,
            "collision": {
              "x": 7,
              "y": 3,
              "w": 1,
              "h": 4
            }
          },
          {
            "kind": "cakeTable",
            "room": "hall",
            "baked": true,
            "x": 2,
            "y": 11,
            "w": 4,
            "h": 3,
            "collision": {
              "x": 2,
              "y": 11,
              "w": 4,
              "h": 3
            }
          },
          {
            "kind": "giftTable",
            "room": "hall",
            "baked": true,
            "x": 34,
            "y": 11,
            "w": 4,
            "h": 3,
            "collision": {
              "x": 34,
              "y": 11,
              "w": 4,
              "h": 3
            }
          },
          {
            "kind": "ringToss",
            "room": "hall",
            "baked": true,
            "x": 2,
            "y": 17,
            "w": 4,
            "h": 4,
            "collision": {
              "x": 2,
              "y": 17,
              "w": 4,
              "h": 4
            }
          },
          {
            "kind": "fishing",
            "room": "hall",
            "baked": true,
            "x": 34,
            "y": 16,
            "w": 4,
            "h": 5,
            "collision": {
              "x": 34,
              "y": 16,
              "w": 4,
              "h": 5
            }
          },
          {
            "kind": "chair",
            "room": "hall",
            "baked": true,
            "x": 11,
            "y": 12,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 11,
              "y": 12,
              "w": 2,
              "h": 2
            },
            "facing": "north"
          },
          {
            "kind": "chair",
            "room": "hall",
            "baked": true,
            "x": 14,
            "y": 12,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 14,
              "y": 12,
              "w": 2,
              "h": 2
            },
            "facing": "north"
          },
          {
            "kind": "chair",
            "room": "hall",
            "baked": true,
            "x": 17,
            "y": 12,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 17,
              "y": 12,
              "w": 2,
              "h": 2
            },
            "facing": "north"
          },
          {
            "kind": "chair",
            "room": "hall",
            "baked": true,
            "x": 23,
            "y": 12,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 23,
              "y": 12,
              "w": 2,
              "h": 2
            },
            "facing": "north"
          },
          {
            "kind": "chair",
            "room": "hall",
            "baked": true,
            "x": 25,
            "y": 12,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 25,
              "y": 12,
              "w": 2,
              "h": 2
            },
            "facing": "north"
          },
          {
            "kind": "chair",
            "room": "hall",
            "baked": true,
            "x": 28,
            "y": 12,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 28,
              "y": 12,
              "w": 2,
              "h": 2
            },
            "facing": "north"
          },
          {
            "kind": "chair",
            "room": "hall",
            "baked": true,
            "x": 11,
            "y": 14,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 11,
              "y": 14,
              "w": 2,
              "h": 2
            },
            "facing": "north"
          },
          {
            "kind": "chair",
            "room": "hall",
            "baked": true,
            "x": 14,
            "y": 14,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 14,
              "y": 14,
              "w": 2,
              "h": 2
            },
            "facing": "north"
          },
          {
            "kind": "chair",
            "room": "hall",
            "baked": true,
            "x": 17,
            "y": 14,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 17,
              "y": 14,
              "w": 2,
              "h": 2
            },
            "facing": "north"
          },
          {
            "kind": "chair",
            "room": "hall",
            "baked": true,
            "x": 23,
            "y": 14,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 23,
              "y": 14,
              "w": 2,
              "h": 2
            },
            "facing": "north"
          },
          {
            "kind": "chair",
            "room": "hall",
            "baked": true,
            "x": 25,
            "y": 14,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 25,
              "y": 14,
              "w": 2,
              "h": 2
            },
            "facing": "north"
          },
          {
            "kind": "chair",
            "room": "hall",
            "baked": true,
            "x": 28,
            "y": 14,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 28,
              "y": 14,
              "w": 2,
              "h": 2
            },
            "facing": "north"
          },
          {
            "kind": "chair",
            "room": "hall",
            "baked": true,
            "x": 11,
            "y": 17,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 11,
              "y": 17,
              "w": 2,
              "h": 2
            },
            "facing": "north"
          },
          {
            "kind": "chair",
            "room": "hall",
            "baked": true,
            "x": 14,
            "y": 17,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 14,
              "y": 17,
              "w": 2,
              "h": 2
            },
            "facing": "north"
          },
          {
            "kind": "chair",
            "room": "hall",
            "baked": true,
            "x": 17,
            "y": 17,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 17,
              "y": 17,
              "w": 2,
              "h": 2
            },
            "facing": "north"
          },
          {
            "kind": "chair",
            "room": "hall",
            "baked": true,
            "x": 23,
            "y": 17,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 23,
              "y": 17,
              "w": 2,
              "h": 2
            },
            "facing": "north"
          },
          {
            "kind": "chair",
            "room": "hall",
            "baked": true,
            "x": 25,
            "y": 17,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 25,
              "y": 17,
              "w": 2,
              "h": 2
            },
            "facing": "north"
          },
          {
            "kind": "chair",
            "room": "hall",
            "baked": true,
            "x": 28,
            "y": 17,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 28,
              "y": 17,
              "w": 2,
              "h": 2
            },
            "facing": "north"
          },
          {
            "kind": "chair",
            "room": "hall",
            "baked": true,
            "x": 11,
            "y": 19,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 11,
              "y": 19,
              "w": 2,
              "h": 2
            },
            "facing": "north"
          },
          {
            "kind": "chair",
            "room": "hall",
            "baked": true,
            "x": 14,
            "y": 19,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 14,
              "y": 19,
              "w": 2,
              "h": 2
            },
            "facing": "north"
          },
          {
            "kind": "chair",
            "room": "hall",
            "baked": true,
            "x": 17,
            "y": 19,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 17,
              "y": 19,
              "w": 2,
              "h": 2
            },
            "facing": "north"
          },
          {
            "kind": "chair",
            "room": "hall",
            "baked": true,
            "x": 23,
            "y": 19,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 23,
              "y": 19,
              "w": 2,
              "h": 2
            },
            "facing": "north"
          },
          {
            "kind": "chair",
            "room": "hall",
            "baked": true,
            "x": 25,
            "y": 19,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 25,
              "y": 19,
              "w": 2,
              "h": 2
            },
            "facing": "north"
          },
          {
            "kind": "chair",
            "room": "hall",
            "baked": true,
            "x": 28,
            "y": 19,
            "w": 2,
            "h": 2,
            "collision": {
              "x": 28,
              "y": 19,
              "w": 2,
              "h": 2
            },
            "facing": "north"
          },
          {
            "kind": "stageSteps",
            "room": "hall",
            "baked": true,
            "x": 18,
            "y": 9,
            "w": 4,
            "h": 2
          },
          {
            "kind": "stageCurtains",
            "room": "hall",
            "baked": true,
            "x": 9,
            "y": 0,
            "w": 26,
            "h": 10
          },
          {
            "kind": "rug",
            "room": "hall",
            "baked": true,
            "x": 18.5,
            "y": 10,
            "w": 3,
            "h": 15
          }
        ],
        "areas": [
          {
            "id": "hall",
            "title": "生日会礼堂",
            "rect": {
              "x": 0,
              "y": 0,
              "w": 40,
              "h": 28
            },
            "bounds": {
              "x": 0,
              "y": 0,
              "w": 40,
              "h": 28
            }
          },
          {
            "id": "backstage",
            "title": "后台化妆间",
            "rect": {
              "x": 40,
              "y": 3,
              "w": 28,
              "h": 25
            }
          }
        ],
        "outdoor": false,
        "entryFade": 1.4,
        "stageRect": {
          "x": 10,
          "y": 4,
          "w": 25,
          "h": 5
        },
        "party": {
          "background": {
            "art": "birthdayHall",
            "x": 0,
            "y": 0,
            "w": 40,
            "h": 28
          },
          "sprites": [
            [
              [
                114,
                34,
                162,
                308
              ],
              [
                411,
                32,
                174,
                310
              ]
            ],
            [
              [
                699,
                59,
                182,
                283
              ],
              [
                1002,
                61,
                194,
                281
              ]
            ],
            [
              [
                90,
                395,
                167,
                296
              ],
              [
                398,
                395,
                168,
                296
              ]
            ],
            [
              [
                698,
                389,
                185,
                303
              ],
              [
                1005,
                389,
                181,
                303
              ]
            ],
            [
              [
                106,
                728,
                129,
                221
              ],
              [
                409,
                733,
                128,
                216
              ]
            ],
            [
              [
                694,
                728,
                190,
                221
              ],
              [
                1004,
                728,
                188,
                221
              ]
            ],
            [
              [
                107,
                979,
                128,
                218
              ],
              [
                410,
                979,
                130,
                221
              ]
            ],
            [
              [
                716,
                979,
                146,
                218
              ],
              [
                1027,
                979,
                145,
                221
              ]
            ]
          ],
          "animations": {
            "adultBlue": {
              "art": "adultBlue",
              "height": 40,
              "width": 20,
              "frames": [
                [
                  [
                    100,
                    18,
                    177,
                    311,
                    71.567
                  ],
                  [
                    401,
                    18,
                    178,
                    314,
                    72.43
                  ],
                  [
                    697,
                    22,
                    178,
                    310,
                    72.425
                  ],
                  [
                    992,
                    20,
                    181,
                    313,
                    71.42
                  ]
                ],
                [
                  [
                    80,
                    346,
                    184,
                    289,
                    117.31
                  ],
                  [
                    378,
                    346,
                    185,
                    290,
                    119.164
                  ],
                  [
                    675,
                    346,
                    186,
                    291,
                    114.136
                  ],
                  [
                    976,
                    346,
                    185,
                    294,
                    118.369
                  ]
                ],
                [
                  [
                    101,
                    656,
                    155,
                    296,
                    76.114
                  ],
                  [
                    401,
                    657,
                    154,
                    294,
                    73.373
                  ],
                  [
                    697,
                    656,
                    155,
                    297,
                    77.183
                  ],
                  [
                    999,
                    657,
                    154,
                    297,
                    78.782
                  ]
                ],
                [
                  [
                    82,
                    965,
                    190,
                    285,
                    70.155
                  ],
                  [
                    381,
                    965,
                    193,
                    289,
                    68.322
                  ],
                  [
                    679,
                    965,
                    191,
                    286,
                    70.98
                  ],
                  [
                    977,
                    965,
                    190,
                    289,
                    75.004
                  ]
                ]
              ],
              "alternateFeet": true
            },
            "childBlue": {
              "art": "childBlue",
              "height": 25,
              "width": 15,
              "frames": [
                [
                  [
                    124,
                    105,
                    146,
                    247,
                    71.762
                  ],
                  [
                    426,
                    105,
                    148,
                    247,
                    72.676
                  ],
                  [
                    705,
                    105,
                    149,
                    247,
                    72.247
                  ],
                  [
                    994,
                    105,
                    148,
                    252,
                    73.228
                  ]
                ],
                [
                  [
                    125,
                    387,
                    147,
                    245,
                    81.518
                  ],
                  [
                    423,
                    387,
                    147,
                    246,
                    78.198
                  ],
                  [
                    707,
                    387,
                    145,
                    246,
                    79.382
                  ],
                  [
                    999,
                    388,
                    152,
                    247,
                    72.749
                  ]
                ],
                [
                  [
                    123,
                    661,
                    147,
                    247,
                    72.25
                  ],
                  [
                    421,
                    662,
                    148,
                    246,
                    56.913
                  ],
                  [
                    703,
                    661,
                    150,
                    247,
                    75.327
                  ],
                  [
                    996,
                    661,
                    148,
                    250,
                    73.528
                  ]
                ],
                [
                  [
                    124,
                    934,
                    148,
                    241,
                    63.009
                  ],
                  [
                    417,
                    934,
                    149,
                    242,
                    75.516
                  ],
                  [
                    705,
                    934,
                    149,
                    241,
                    65.295
                  ],
                  [
                    993,
                    935,
                    147,
                    243,
                    77.657
                  ]
                ]
              ],
              "alternateFeet": true
            },
            "parent": {
              "art": "parent",
              "height": 40,
              "width": 20,
              "frames": [
                [
                  [
                    110,
                    44,
                    189,
                    291,
                    93.117
                  ],
                  [
                    393,
                    44,
                    189,
                    291,
                    92.79
                  ],
                  [
                    675,
                    44,
                    187,
                    291,
                    94.919
                  ],
                  [
                    948,
                    44,
                    187,
                    294,
                    95.273
                  ]
                ],
                [
                  [
                    110,
                    358,
                    172,
                    288,
                    100.225
                  ],
                  [
                    396,
                    358,
                    172,
                    288,
                    99.869
                  ],
                  [
                    676,
                    358,
                    171,
                    288,
                    101.976
                  ],
                  [
                    947,
                    358,
                    173,
                    288,
                    101.056
                  ]
                ],
                [
                  [
                    111,
                    664,
                    182,
                    278,
                    89.241
                  ],
                  [
                    399,
                    664,
                    183,
                    277,
                    91.598
                  ],
                  [
                    679,
                    664,
                    185,
                    278,
                    92.77
                  ],
                  [
                    951,
                    664,
                    186,
                    277,
                    91.925
                  ]
                ],
                [
                  [
                    118,
                    959,
                    177,
                    289,
                    69.248
                  ],
                  [
                    401,
                    959,
                    175,
                    289,
                    75.479
                  ],
                  [
                    689,
                    959,
                    172,
                    290,
                    69.874
                  ],
                  [
                    961,
                    959,
                    173,
                    290,
                    75.754
                  ]
                ]
              ],
              "alternateFeet": true
            },
            "childPink": {
              "art": "childPink",
              "height": 25,
              "width": 15,
              "frames": [
                [
                  [
                    82,
                    65,
                    220,
                    251,
                    115.75
                  ],
                  [
                    378,
                    64,
                    225,
                    253,
                    108.222
                  ],
                  [
                    677,
                    64,
                    220,
                    252,
                    134.273
                  ],
                  [
                    974,
                    64,
                    222,
                    253,
                    124.235
                  ]
                ],
                [
                  [
                    93,
                    357,
                    180,
                    259,
                    101.5
                  ],
                  [
                    386,
                    357,
                    188,
                    262,
                    116.769
                  ],
                  [
                    691,
                    357,
                    182,
                    259,
                    87.684
                  ],
                  [
                    991,
                    357,
                    182,
                    264,
                    80.625
                  ]
                ],
                [
                  [
                    80,
                    645,
                    222,
                    244,
                    124.364
                  ],
                  [
                    381,
                    644,
                    223,
                    248,
                    107.692
                  ],
                  [
                    677,
                    646,
                    220,
                    243,
                    74.417
                  ],
                  [
                    974,
                    645,
                    220,
                    247,
                    113.786
                  ]
                ],
                [
                  [
                    107,
                    921,
                    185,
                    252,
                    68.75
                  ],
                  [
                    413,
                    921,
                    182,
                    255,
                    59.2
                  ],
                  [
                    705,
                    921,
                    184,
                    252,
                    81.056
                  ],
                  [
                    1007,
                    921,
                    188,
                    254,
                    76.769
                  ]
                ]
              ],
              "alternateFeet": true
            },
            "childYellow": {
              "art": "childYellow",
              "height": 25,
              "width": 15,
              "frames": [
                [
                  [
                    99,
                    84,
                    171,
                    272,
                    87.437
                  ],
                  [
                    403,
                    84,
                    171,
                    275,
                    84.809
                  ],
                  [
                    698,
                    84,
                    170,
                    272,
                    87.418
                  ],
                  [
                    1014,
                    84,
                    172,
                    275,
                    87.527
                  ]
                ],
                [
                  [
                    105,
                    386,
                    167,
                    264,
                    70.799
                  ],
                  [
                    415,
                    384,
                    166,
                    267,
                    64.397
                  ],
                  [
                    704,
                    386,
                    166,
                    264,
                    71.46
                  ],
                  [
                    1023,
                    384,
                    167,
                    267,
                    63.805
                  ]
                ],
                [
                  [
                    109,
                    670,
                    163,
                    257,
                    78.668
                  ],
                  [
                    410,
                    670,
                    165,
                    262,
                    80.974
                  ],
                  [
                    704,
                    670,
                    168,
                    257,
                    82.93
                  ],
                  [
                    1018,
                    670,
                    165,
                    263,
                    81.759
                  ]
                ],
                [
                  [
                    96,
                    948,
                    166,
                    253,
                    99.413
                  ],
                  [
                    403,
                    947,
                    168,
                    255,
                    96.22
                  ],
                  [
                    707,
                    947,
                    166,
                    255,
                    96.49
                  ],
                  [
                    1018,
                    947,
                    166,
                    257,
                    102.707
                  ]
                ]
              ],
              "alternateFeet": true
            }
          },
          "muses": {
            "lily": {
              "art": "museCostumes",
              "height": 40,
              "detailScale": 1.5,
              "maxWidth": 34,
              "frames": [
                [
                  [
                    112,
                    25,
                    157,
                    243,
                    77.5
                  ]
                ],
                [
                  [
                    806,
                    25,
                    118,
                    243,
                    62.5
                  ]
                ],
                [
                  [
                    562,
                    25,
                    155,
                    243,
                    77.0
                  ]
                ],
                [
                  [
                    359,
                    25,
                    118,
                    243,
                    53.5
                  ]
                ]
              ]
            },
            "haewon": {
              "art": "museCostumes",
              "height": 40,
              "detailScale": 1.5,
              "maxWidth": 34,
              "frames": [
                [
                  [
                    117,
                    275,
                    145,
                    238,
                    72.0
                  ]
                ],
                [
                  [
                    806,
                    275,
                    118,
                    238,
                    65.5
                  ]
                ],
                [
                  [
                    569,
                    275,
                    141,
                    238,
                    70.5
                  ]
                ],
                [
                  [
                    357,
                    275,
                    118,
                    238,
                    53.0
                  ]
                ]
              ]
            },
            "sullyoon": {
              "art": "museCostumes",
              "height": 40,
              "detailScale": 1.5,
              "maxWidth": 34,
              "frames": [
                [
                  [
                    107,
                    519,
                    166,
                    257,
                    82.5
                  ]
                ],
                [
                  [
                    786,
                    519,
                    136,
                    258,
                    84.0
                  ]
                ],
                [
                  [
                    558,
                    519,
                    163,
                    258,
                    81.5
                  ]
                ],
                [
                  [
                    360,
                    519,
                    135,
                    258,
                    51.0
                  ]
                ]
              ]
            },
            "bae": {
              "art": "museCostumes",
              "height": 40,
              "detailScale": 1.5,
              "maxWidth": 34,
              "frames": [
                [
                  [
                    123,
                    783,
                    132,
                    254,
                    65.5
                  ]
                ],
                [
                  [
                    807,
                    783,
                    119,
                    254,
                    68.5
                  ]
                ],
                [
                  [
                    575,
                    783,
                    130,
                    254,
                    65.0
                  ]
                ],
                [
                  [
                    354,
                    783,
                    121,
                    254,
                    50.5
                  ]
                ]
              ]
            },
            "jiwoo": {
              "art": "museCostumes",
              "height": 40,
              "detailScale": 1.5,
              "maxWidth": 34,
              "frames": [
                [
                  [
                    113,
                    1037,
                    166,
                    252,
                    75.0
                  ]
                ],
                [
                  [
                    781,
                    1038,
                    149,
                    252,
                    92.0
                  ]
                ],
                [
                  [
                    557,
                    1040,
                    164,
                    250,
                    82.5
                  ]
                ],
                [
                  [
                    351,
                    1038,
                    148,
                    252,
                    55.5
                  ]
                ]
              ]
            },
            "kyujin": {
              "art": "museCostumes",
              "height": 40,
              "detailScale": 1.5,
              "maxWidth": 34,
              "frames": [
                [
                  [
                    95,
                    1296,
                    189,
                    230,
                    94.0
                  ]
                ],
                [
                  [
                    786,
                    1296,
                    138,
                    230,
                    87.0
                  ]
                ],
                [
                  [
                    545,
                    1296,
                    190,
                    230,
                    94.5
                  ]
                ],
                [
                  [
                    355,
                    1296,
                    139,
                    230,
                    50.0
                  ]
                ]
              ]
            }
          },
          "playerMotion": "parent"
        }
      }
    ],

    /* ══════════ 对话稿（GAME_DESIGN.md §8，v0.3 全文） ══════════ */

    dialogue: {

  "l1.rings.complete": {
    "type": "cutscene",
    "trigger": "interact:ring-toss",
    "once": true,
    "lines": [
      {
        "s": "bae",
        "t": "鲸鱼、月亮、星星，全中！第一颗愿望之星就在摊位前，收下吧。第二颗在左上杂物间。"
      }
    ]
  }
,
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
          { s: 'lily', t: '第一颗星在左边的套圈摊位，Bae 会教你怎么玩。把鲸鱼、月亮、星星都套中，就能拿到啦。' },
          { s: 'haewon', t: '杂物间按 E 开门，里面有第二颗星。先和六位 Muse 都聊聊，再找齐两颗星——然后去舞台上看看唱片机。' },
          { s: 'haewon', t: '顺带一提，在这个梦里我们都有神话倒影——Lily 是春天，我是冥王。今天冥王也得当幼儿园小主持人。' },
          { s: 'haewon', t: '操作提示：方向键 / WASD 移动，E 或空格互动。手机用屏幕方向键和 A 键。' },
          { s: 'lily', t: '慢慢来。小时候的生日会，本来就不赶时间。응답하라 NSWER！' },
        ],
        next: 'l1.lily.hint',
      },
      'l1.star1': {
        type: 'star', trigger: 'star:s1', once: true,
        lines: [
          { s: 'lily', t: '第一颗愿望之星！你把三个圈都套中了，像小时候收到第一颗糖一样开心吧？' },
          { s: 'haewon', t: '左上角 HUD 会帮你数星星。别嫌我们啰嗦，幼儿园老师都这样。' },
        ],
      },
      'l1.star3': {
        type: 'star', trigger: 'star:s3', once: true,
        lines: [
          { s: 'haewon', t: '精灵、Sullyoon、Lily 都聊过了，化妆间里最后那颗星星出现了！' },
          { s: 'lily', t: '把最后的星星收好，左侧的星光门就会亮起来。' },
          { s: 'nar', t: '化妆镜的灯光映着星星，你听见下一场生日会轻轻开了门。' },
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
          { s: 'haewon', t: '我是今天的鼓手。唱片放在左上杂物间的矮柜上，从南侧木门进去就能看见。先和大家聊聊、找齐两颗星，再拿回来播放吧。' },
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
          { s: 'bae', t: '先来玩套圈吧！到左侧摊位前按 E / A，依次套中鲸鱼、月亮和星星，就能拿到第一颗星。没套中也可以重试。第二颗星在左上杂物间，门从南边开。' },
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
          { s: 'kyujin', t: '吉他已经调好音了。还缺杂物间里的唱片——拿回来放到右边唱片机，音乐响起后向右穿过蓝幕布，就到后台了。进去后就沿星光门继续旅程，不能回礼堂。' },
        ],
      },
      'l1.lily.hint': {
        type: 'hint', trigger: 'npc:lily', once: false,
        lines: [
          { s: 'lily', t: '欢迎来到生日会！先和六位 Muse 聊聊；左边套圈摊位藏着第一颗星，左上杂物间里有第二颗。杂物间从南侧按 E / A 开门，唱片线索问舞台上的鼓手和吉他手。' },
          { s: 'lily', t: '小时候的生日会，本来就是要慢慢过的呀。' },
        ],
      },
      'l1.haewon.hint': {
        type: 'hint', trigger: 'npc:haewon', once: false,
        lines: [{s:'haewon',t:'唱片在左上杂物间的矮柜上，从南侧门按 E / A 进去。六段自我介绍和套圈、杂物间的两颗星齐备后，再把唱片带回来播放。'}],
      },
      'l1.kyujin.hint': {
        type:'hint', trigger:'npc:kyujin', once:false,
        lines:[{s:'kyujin',t:'唱片拿回来了吗？放进右边唱片机，等音乐响起再向右走进蓝色幕布。后台不能回礼堂，想玩的先玩好。'}],
      },
      'l1.bae.hint': {
        type:'hint', trigger:'npc:bae', once:false,
        lines:[{s:'bae',t:'左侧摊位前按 E / A 套圈。光标进入金色区域时投圈，鲸鱼、月亮、星星全部套中就有星星啦！'}],
      },
      'l1.byeori.hint': {
        type: 'hint', trigger: 'npc:byeori', once: false,
        room: 'backstage',
        lines: [{ s: 'byeori', t: '딩동댕！三颗愿望之星会点亮这扇星光门。生日会的下一站，是 Jiwoo 的灯油长廊！' }],
      },
      "l1.music.ready": {
        "type": "cutscene",
        "trigger": "trigger:music-ready",
        "once": true,
        "lines": [
          {
            "s": "nar",
            "t": "唱片机的金色喇叭闪了闪光。六份祝福和两颗星都齐了，还少一张唱片。"
          },
          {
            "s": "haewon",
            "t": "去左上角的杂物间找找《Strange Muse》吧！按 E 取走唱片，再回这里按 E 播放，右侧的帷幕就会打开。"
          }
        ]
      },
      "l1.record.take": {
        "type": "cutscene",
        "trigger": "interact:birthday-record",
        "once": true,
        "lines": [
          {
            "s": "nar",
            "t": "你从舞台杂物中找到了一张《Strange Muse》唱片，熟悉的专辑封面映入眼帘。"
          },
          {
            "s": "nar",
            "t": "带回舞台上的唱片机，按 E 放入并播放。"
          }
        ]
      },
      "l1.music.play": {
        "type": "cutscene",
        "trigger": "interact:stage-music",
        "once": true,
        "lines": [
          {
            "s": "nar",
            "t": "你把《Strange Muse》唱片放到转盘上，唱针轻轻落下。"
          },
          {
            "s": "nar",
            "t": "温柔的旋律响起。向右走，直接进入蓝色幕布后面，就到后台化妆间了。"
          }
        ]
      },
      "l1.backstage.lily": {
        "type": "npc",
        "trigger": "npc:lily",
        "room": "backstage",
        "once": true,
        "lines": [
          {
            "s": "lily",
            "t": "到了化妆间就好好喘口气。把最后一颗星星带上，下一站也会有人认真等你。"
          }
        ]
      },
      "l1.backstage.sullyoon": {
        "type": "npc",
        "trigger": "npc:sullyoon",
        "room": "backstage",
        "once": true,
        "lines": [
          {
            "s": "sullyoon",
            "t": "化妆镜会记得今天的光。愿望的最后一笔，留给你来写。"
          }
        ]
      },
      "l1.backstage.byeori": {
        "type": "npc",
        "trigger": "npc:byeori",
        "room": "backstage",
        "once": true,
        "lines": [
          {
            "s": "byeori",
            "t": "딩동댕！和 Lily、Sullyoon、我都聊过之后，最后的愿望之星就会出现。收好它，左侧的星光门会带你去下一关。"
          }
        ]
      },
      "l1.backstage.haewon": {
        "type": "npc",
        "trigger": "npc:haewon",
        "room": "backstage",
        "once": true,
        "lines": [
          {
            "s": "haewon",
            "t": "后台也热闹得很。镜子前的灯都亮着，别落下你的愿望。"
          }
        ]
      },
      "l1.backstage.bae": {
        "type": "npc",
        "trigger": "npc:bae",
        "room": "backstage",
        "once": true,
        "lines": [
          {
            "s": "bae",
            "t": "终于可以休息一下啦！这张圆凳给你，今天的寿星。"
          }
        ]
      },
      "l1.backstage.jiwoo": {
        "type": "npc",
        "trigger": "npc:jiwoo",
        "room": "backstage",
        "once": true,
        "lines": [
          {
            "s": "jiwoo",
            "t": "星光门就在左侧！下一站由信使 Jiwoo 接力，咻——！"
          }
        ]
      },
      "l1.backstage.kyujin": {
        "type": "npc",
        "trigger": "npc:kyujin",
        "room": "backstage",
        "once": true,
        "lines": [
          {
            "s": "kyujin",
            "t": "舞台走得不错。下一次，继续保持。"
          }
        ]
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
          { s: 'kyujin', t: '这里的门都是「单向门」，只能顺着箭头穿过。想回来，就找环线。看地上的霓虹箭头，那是指路牌。' },
          { s: 'kyujin', t: '敢说出自己的态度，就够酷。对那些乱嚼舌根的人，我从来只回一句——So what?' },
          { s: 'kyujin', t: '前面的 DJ 会问你一个「态度检查」。信任我，就走我推荐的捷径；相信自己，就去霓虹小巷亮一手。两种自信，我都欣赏。' },
        ],
        next: 'l3.hint',
      },
      'l3.dj.check': {
        type: 'check',
        trigger: 'npc:dj',
        once: false,
        lines: [
          { s: 'dj', t: '哟，新来的。亮出你的态度——这条街最酷的人是谁？' },
          { s: 'dj', t: '两条路都值得探索，之后可以回来重新选择。顺着霓虹箭头走完环线，就能回到我这儿。' },
        ],
        options: [
          { label: '「Kyujin。」', goto: 'l3.dj.right' },
          { label: '「我自己。」', goto: 'l3.dj.wrong' },
        ],
      },
      // 保留既有分支 ID 以兼容引用；right / wrong 不再表示答案对错。
      'l3.dj.right': {
        type: 'check', trigger: 'npc:dj', once: false,
        lines: [
          { s: 'dj', t: '很会说话嘛！既然这么信任她，就走她推荐的捷径吧。' },
          { s: 'dj', t: '两条路都值得探索，之后可以回来重新选择。小巷里也藏着星星，记得来看看！' },
        ],
      },
      'l3.dj.wrong': {
        type: 'check', trigger: 'npc:dj', once: false,
        lines: [
          { s: 'dj', t: '哦？敢这么说，有点意思！那就让我看看你自己的本事。霓虹小巷等你来探索！' },
          { s: 'dj', t: '两条路都值得探索，之后可以回来重新选择。捷径里也有星星，记得来看看！' },
        ],
      },
      'l3.hint': {
        type: 'hint', trigger: 'npc:kyujin', once: false,
        lines: [{ s: 'kyujin', t: '顺着箭头走，环线会带你回到 DJ 那儿。捷径和小巷各藏着星星，两条都去看看吧。' }],
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
      // HEAT/OASIS 尚未接入；绿洲布点与耗尽事件稿见 GAME_DESIGN.md §5.5 / §8.6。
      'l5.intro': {
        type: 'intro',
        trigger: 'npc:bae',
        once: true,
        lines: [
          { s: 'bae', t: '好——热——！这里本来该是丰收的田野，愿望之星一散，大地就荒成沙漠了。' },
          { s: 'bae', t: '不过没关系，绿洲就是大地的笑意。右上角的「清凉条」从 100 秒开始，离开绿洲才会慢慢下降。' },
          { s: 'sullyoon', t: '绿洲能恢复清凉；对话的时候计时会暂停，放心聊天。' },
          { s: 'sullyoon', t: '五颗星星藏在迷宫深处，不用一口气找齐。清凉耗尽就回最近到访的绿洲休息，找到的星星会一直陪着你。' },
          { s: 'bae', t: '在绿洲歇一会儿，周围的植物也会慢慢恢复颜色。大地在陪你一起缓过来！' },
        ],
        next: 'l5.bae.hint',
      },
      'l5.sullyoon.hint': {
        type: 'hint', trigger: 'npc:sullyoon', once: false,
        lines: [{ s: 'sullyoon', t: '先找绿洲，再找星星。清凉耗尽也不会丢掉星星，按自己的节奏走就好。' }],
      },
      'l5.bae.hint': {
        type: 'hint', trigger: 'npc:bae', once: false,
        lines: [{ s: 'bae', t: '玫瑰能在最干的地方开花，你也能找到路。累了就回绿洲歇歇，我陪你看大地重新变绿！' }],
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
          { s: 'sullyoon', t: '外面再热，也挡不住我们按自己的节奏走到这里。Hot \'n unbothered，就是这份从容。' },
          { s: 'bae', t: '五颗星星到手！大地又开花了——看，玫瑰。歇好了，我们就从传送门出发！' },
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
        lines: [{ s: 'sheep', t: '最酷的态度，是欣赏别人的光，也敢亮出自己的光。' }],
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
