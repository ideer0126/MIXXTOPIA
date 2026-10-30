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
      haewon: { name: 'Haewon', color: '#FFB14E', portrait: 'assets/characters/haewon/art/haewon-1.png', portraitBottom: 55 / 1448 },
      sullyoon: { name: 'Sullyoon', color: '#B49BFF' },
      bae: { name: 'Bae', color: '#FF7BA9' },
      jiwoo: { name: 'Jiwoo', color: '#FFE066' },
      kyujin: { name: 'Kyujin', color: '#5EE6B8' },
      byeori: { name: 'Byeori', color: '#FFD700', portrait: 'assets/characters/byeori/art/byeori.png', portraitBottom: 212 / 1448 },
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
        "starCount": 3,
        "combat": false,
        "map": {
          "w": 68,
          "h": 28,
          "rows": [
            "####################################################################",
            "#········###########################################################",
            "#········###########################################################",
            "#········###########################################################",
            "#········#······················####################################",
            "#········#·····························#############################",
            "#········#·····························##········FFFFFFFFFFFFFFF···#",
            "#········#·····························##·FF·FF··FFFFFFFFFFFFFFF···#",
            "#······································##·FF·····FFFFFFFFFFFFFFF···#",
            "#······································##·········F··F··F··F··F····#",
            "#······································##·FF·F·····················#",
            "#······································##··························#",
            "#······································##·········F··F··F··F··F····#",
            "#······································##········FFFFFFFFFFFFFFF···#",
            "#······································##········FFFFFFFFFFFFFFF···#",
            "#······································##········FFFFFFFFFFFFFFF···#",
            "#······································##········FFFFFFFFFFFFFFF···#",
            "#······································##········FFFFFFFFFFFFFFF···#",
            "#······································##········FFFFFFFFFFFFFFF···#",
            "#······································##·········F··F··F··F··F····#",
            "#······································##··························#",
            "#······································##··························#",
            "#······································##·········F··F··F··F··F····#",
            "#······································##·FFFFF··FFFFFFFFFFFFFFF···#",
            "##################····#··################·FFFFF··FFFFFFFFFFFFFFF···#",
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
            "y": 22,
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
            "spriteOffsetX": -0.6,
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
            "x": 21,
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
            "type": "roomdoor",
            "id": "to-backstage",
            "x": 33,
            "y": 6,
            "to": {
              "x": 65,
              "y": 20
            },
            "label": "右侧幕布后 · 化妆间",
            "visual": "curtain",
            "fadeIn": true,
            "enterFrom": "south",
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
            "x": 33,
            "y": 6,
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
            "y": 22,
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
                20
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
            "x": 13,
            "y": 21,
            "sprite": 5,
            "path": [
              [
                13,
                21
              ],
              [
                15,
                21
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
            "x": 27,
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
          "birthdayHall": "assets/scenes/level1/birthday-hall-v3.png",
          "guests": "assets/scenes/level1/party-guests-v2.png",
          "museCostumes": "assets/scenes/level1/muse-costumes-v4.png",
          "haewonDrums": "assets/scenes/level1/haewon-drums-v1.png",
          "kyujinGuitar": "assets/scenes/level1/kyujin-guitar-v1.png",
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
          },
          {
            "kind": "stageBalloons",
            "room": "hall",
            "baked": true,
            "x": 9.44,
            "y": 4.8,
            "w": 2,
            "h": 3.36,
            "depth": 8.32,
            "occlusionShapes": [
              [[0.44,0.02],[0.65,0.02],[0.65,0],[0.72,0],[0.72,0.05],[0.8,0.05],[0.8,0.18],[0.86,0.18],[0.86,0.31],[0.94,0.31],[0.94,0.4],[0.99,0.4],[0.99,0.57],[0.91,0.57],[0.91,0.67],[0.73,0.67],[0.73,0.76],[0.65,0.76],[0.65,0.8],[0.57,0.8],[0.57,0.83],[0.4,0.83],[0.4,0.8],[0.29,0.8],[0.29,0.74],[0.2,0.74],[0.2,0.67],[0.12,0.67],[0.12,0.63],[0.05,0.63],[0.05,0.57],[0,0.57],[0,0.45],[0.1,0.45],[0.1,0.39],[0.18,0.39],[0.18,0.27],[0.27,0.27],[0.27,0.2],[0.39,0.2],[0.39,0.08],[0.44,0.08]],
              [[0.33,0.79],[0.36,0.79],[0.36,0.85],[0.43,0.9],[0.46,0.99],[0.43,0.99],[0.4,0.92],[0.32,0.86]],
              [[0.61,0.8],[0.64,0.8],[0.55,1],[0.52,1]]
            ]
          },
          {
            "kind": "stageBalloonBase",
            "room": "hall",
            "baked": true,
            "x": 10.08,
            "y": 7.980934,
            "w": 0.906667,
            "h": 2.135367,
            "collision": {
              "x": 10.24,
              "y": 8.1067,
              "w": 0.4267,
              "h": 0.2133
            },
            "depth": 8.32,
            "occlusionShapes": [
              [[0.294118,0.0125],[0.5,0.0],[0.647059,0.0375],[0.647059,0.0875],[0.529412,0.1375],[0.352941,0.125],[0.235294,0.075]],
              [[0.058824,0.0625],[0.176471,0.0375],[0.352941,0.1],[0.470588,0.15],[0.411765,0.2625],[0.205882,0.325],[0.029412,0.2875]],
              [[0.558823,0.1],[0.764706,0.0625],[0.911764,0.0875],[0.970588,0.175],[0.882353,0.2875],[0.735294,0.325],[0.558823,0.25]],
              [[0.382353,0.275],[0.558823,0.275],[0.617647,0.4375],[0.705882,0.6125],[0.705882,0.9125],[0.617647,0.9375],[0.558823,0.9],[0.5,0.9875],[0.411765,0.9875],[0.352941,0.9125],[0.235294,0.9375],[0.176471,0.9],[0.235294,0.6125],[0.294118,0.45]],
              [[0.088235,0.325],[0.235294,0.3375],[0.147059,0.4375],[0.0,0.4625],[0.0,0.4125]],
              [[0.705882,0.3375],[0.852941,0.3125],[0.970588,0.4],[0.970588,0.45],[0.764706,0.45]]
            ]
          },
          {
            "kind": "piano",
            "x": 11.6,
            "y": 3.8704,
            "w": 3.8933,
            "h": 3.897,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {"x":0.1067,"y":1.4947,"w":3.5733,"h":1.5748},
              {"x":0.32,"y":2.9895,"w":0.24,"h":0.2669},
              {"x":1.3867,"y":3.0429,"w":0.32,"h":0.5872},
              {"x":2.32,"y":2.8026,"w":0.2133,"h":0.3737},
              {"x":2.5867,"y":2.6959,"w":1.2,"h":0.8541},
              {"x":2.64,"y":3.55,"w":0.2133,"h":0.2135},
              {"x":3.0667,"y":3.55,"w":0.2133,"h":0.2936},
              {"x":3.6,"y":3.55,"w":0.1867,"h":0.1868}
            ],
            "depth": 7.7674,
            "occlusionShapes": [
              [[0.0274,0.274],[0.6164,0.0274],[0.6918,0.0137],[0.7329,0.0205],[0.7329,0.0616],[0.3356,0.4863],[0.0274,0.363]],
              [[0.0205,0.363],[0.3288,0.5],[0.3973,0.452],[0.6575,0.2329],[0.7877,0.3082],[0.863,0.3836],[0.863,0.4794],[0.9315,0.5205],[0.9315,0.6438],[0.5343,0.7671],[0.2945,0.7329],[0.0205,0.6027]],
              [[0.0822,0.6164],[0.1438,0.637],[0.1438,0.8082],[0.0822,0.8288]],
              [[0.3562,0.726],[0.4384,0.726],[0.4384,0.9178],[0.3562,0.9315]],
              [[0.5959,0.7055],[0.6507,0.6918],[0.6507,0.8014],[0.5959,0.8151]],
              [[0.6644,0.7123],[0.8219,0.6712],[0.9726,0.7329],[0.9726,0.8151],[0.8151,0.8836],[0.6644,0.8151]],
              [[0.6712,0.8082],[0.726,0.8288],[0.726,0.9452],[0.6712,0.9315]],
              [[0.7877,0.8699],[0.8425,0.863],[0.8425,0.9931],[0.7877,0.9931]],
              [[0.9247,0.8082],[0.9795,0.7945],[0.9795,0.9247],[0.9247,0.9384]]
            ]
          },
          {
            "kind": "drums",
            "x": 15.733333,
            "y": 4.697807,
            "w": 4.0,
            "h": 2.695901,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.784967,
                "y": 1.702193,
                "w": 2.125,
                "h": 1.04
              },
              {
                "x": 0.159967,
                "y": 1.952193,
                "w": 0.5,
                "h": 0.79
              },
              {
                "x": 3.409967,
                "y": 1.952193,
                "w": 0.6433,
                "h": 0.79
              }
            ],
            "depth": 7.44,
            "foregroundShapes": [
              [[0.301598,0.314886],[0.322664,0.265428],[0.364797,0.245644],[0.417463,0.255536],[0.449063,0.304995],[0.459597,0.532503],[0.322664,0.562178],[0.301598,0.473153]],
              [[0.459597,0.304995],[0.564929,0.304995],[0.564929,0.522612],[0.459597,0.522612]],
              [[0.564929,0.314886],[0.585995,0.265428],[0.628129,0.245644],[0.670262,0.245644],[0.712394,0.295103],[0.722928,0.51272],[0.575462,0.532503]]
            ],
            "occlusionShapes": [
              [[0.173333,0.455446],[0.206667,0.346535],[0.32,0.376238],[0.32,0.267327],[0.366667,0.227723],[0.446667,0.237624],[0.5,0.346535],[0.566667,0.346535],[0.586667,0.257426],[0.64,0.217822],[0.7,0.227723],[0.746667,0.336634],[0.746667,0.386139],[0.813333,0.376238],[0.86,0.455446],[0.853333,0.683168],[0.8,0.772277],[0.746667,0.762376],[0.726667,0.881188],[0.646667,0.950495],[0.393333,0.950495],[0.313333,0.861386],[0.273333,0.752475],[0.186667,0.752475],[0.166667,0.673267]],
              [[0.073333,0.049505],[0.16,0.029703],[0.2,0.079208],[0.266667,0.089109],[0.286667,0.138614],[0.253333,0.188119],[0.113333,0.19802],[0.073333,0.148515]],
              [[0.74,0.079208],[0.82,0.069307],[0.84,0.009901],[0.866667,0.009901],[0.886667,0.079208],[0.966667,0.089109],[0.973333,0.168317],[0.913333,0.227723],[0.786667,0.217822],[0.74,0.158416]],
              [[0.14,0.188119],[0.166667,0.188119],[0.16,0.742574],[0.14,0.772277],[0.12,0.891089],[0.093333,0.881188],[0.106667,0.772277],[0.133333,0.712871]],
              [[0.146667,0.712871],[0.16,0.732673],[0.106667,0.811881],[0.093333,0.891089],[0.066667,0.891089],[0.073333,0.821782]],
              [[0.16,0.712871],[0.193333,0.722772],[0.193333,0.920792],[0.166667,0.930693],[0.16,0.871287]],
              [[0.846667,0.217822],[0.873333,0.217822],[0.873333,0.742574],[0.9,0.792079],[0.98,0.861386],[0.986667,0.930693],[0.96,0.930693],[0.946667,0.881188],[0.866667,0.80198],[0.846667,0.762376]],
              [[0.853333,0.722772],[0.866667,0.752475],[0.82,0.861386],[0.813333,0.930693],[0.786667,0.930693],[0.793333,0.851485]],
              [[0.333333,0.831683],[0.36,0.851485],[0.306667,0.930693],[0.293333,0.980198],[0.26,0.980198],[0.266667,0.930693]],
              [[0.706667,0.841584],[0.733333,0.831683],[0.773333,0.940594],[0.773333,0.980198],[0.746667,0.980198],[0.733333,0.930693]]
            ]
          },
          {
            "kind": "guitars",
            "x": 22.4533,
            "y": 4.9867,
            "w": 3.44,
            "h": 2.56,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.52,
                "y": 1.9066,
                "w": 0.85,
                "h": 0.6
              },
              {
                "x": 2.4367,
                "y": 1.68,
                "w": 1.0033,
                "h": 0.8267
              }
            ],
            "depth": 7.4933,
            "occlusionShapes": [
              [[0.34,0.15],[0.42,0.15],[0.42,0.24],[0.36,0.28],[0.30,0.57],[0.37,0.60],[0.36,0.82],[0.40,0.96],[0.12,0.96],[0.12,0.90],[0.14,0.73],[0.18,0.64],[0.18,0.52],[0.24,0.52],[0.26,0.63],[0.30,0.33],[0.31,0.22]],
              [
                [
                  0.55,
                  0.44
                ],
                [
                  1,
                  0.44
                ],
                [
                  1,
                  1
                ],
                [
                  0.55,
                  1
                ]
              ]
            ]
          },
          {
            "kind": "gramophone",
            "x": 26.8533,
            "y": 4.2667,
            "w": 1.76,
            "h": 3.4133,
            "room": "hall",
            "baked": true,
            "collision": {
              "x": 26.88,
              "y": 6.64,
              "w": 1.7333,
              "h": 1.0133
            },
            "depth": 7.6533,
            "occlusionShape": [
              [
                0.28,
                0
              ],
              [
                0.75,
                0
              ],
              [
                0.98,
                0.28
              ],
              [
                0.7,
                0.43
              ],
              [
                0.65,
                0.6
              ],
              [
                1,
                0.6
              ],
              [
                1,
                1
              ],
              [
                0,
                1
              ],
              [
                0,
                0.62
              ],
              [
                0.43,
                0.6
              ],
              [
                0.4,
                0.45
              ],
              [
                0.05,
                0.35
              ],
              [
                0,
                0.15
              ]
            ]
          },
          {
            "kind": "storageWestWall",
            "room": "hall",
            "baked": true,
            "x": 0,
            "y": 0,
            "w": 2.2133,
            "h": 7.8667,
            "collision": { "x": 0, "y": 0, "w": 2.1333, "h": 7.7333 },
            "depth": 7.7333,
            "occlusionShape": [[0,0],[0.9639,0],[0.9639,0.939],[0.9036,0.939],[0.9036,1],[0,1]]
          },
          {
            "kind": "storageShelves",
            "x": 1.44,
            "y": 0.96,
            "w": 6.88,
            "h": 3.1733,
            "room": "hall",
            "baked": true,
            "collision": {
              "x": 1.4667,
              "y": 0.96,
              "w": 6.8533,
              "h": 3.0933
            },
            "depth": 4.0533
          },
          {
            "kind": "spareChairs",
            "x": 2.2133,
            "y": 3.897,
            "w": 2.8267,
            "h": 2.0553,
            "room": "hall",
            "baked": true,
            "depth": 5.9523,
            "occlusionShapes": [
              [[0.09,0.04],[0.25,0.04],[0.25,0.08],[0.31,0.08],[0.34,0.2],[0.34,0.97],[0.29,0.97],[0.29,0.8],[0.08,0.8],[0.08,0.97],[0.02,0.97],[0.02,0.2],[0.05,0.2],[0.05,0.09]],
              [[0.39,0.04],[0.55,0.04],[0.55,0.08],[0.62,0.08],[0.66,0.2],[0.66,0.98],[0.6,0.98],[0.6,0.8],[0.38,0.8],[0.38,0.98],[0.33,0.98],[0.33,0.2],[0.36,0.2],[0.36,0.09]],
              [[0.73,0.13],[0.87,0.13],[0.87,0.18],[0.94,0.18],[0.94,0.44],[0.98,0.44],[0.98,0.98],[0.92,0.98],[0.92,0.8],[0.7,0.8],[0.7,0.98],[0.65,0.98],[0.65,0.46],[0.7,0.46],[0.7,0.22]]
            ],
            "collision": {
              "x": 2.24,
              "y": 5.1783,
              "w": 2.7467,
              "h": 0.7474
            }
          },
          {
            "kind": "cleaningBucket",
            "room": "hall",
            "baked": true,
            "x": 2.24,
            "y": 5.6,
            "w": 0.8533,
            "h": 1.2,
            "collision": { "x": 2.32, "y": 6.2667, "w": 0.64, "h": 0.5333 },
            "depth": 6.8,
            "occlusionShape": [[0.2,0.04],[0.73,0.04],[0.73,0.1],[0.88,0.1],[0.95,0.24],[0.95,0.84],[0.82,0.84],[0.82,0.98],[0.2,0.98],[0.2,0.89],[0.08,0.89],[0.08,0.23],[0.2,0.23]]
          },
          {
            "kind": "cleaningRack",
            "room": "hall",
            "baked": true,
            "x": 5.36,
            "y": 3.2533,
            "w": 1.1733,
            "h": 3.5467,
            "collision": { "x": 5.5467, "y": 5.8933, "w": 0.9067, "h": 0.9067 },
            "depth": 6.8,
            "occlusionShapes": [
              [[0.05,0.02],[0.23,0.02],[0.23,0.77],[0.18,0.8],[0.05,0.8]],
              [[0.78,0.02],[0.97,0.02],[0.97,0.97],[0.83,0.97]],
              [[0.41,0.12],[0.54,0.12],[0.59,0.2],[0.59,0.57],[0.4,0.57]],
              [[0.29,0.56],[0.62,0.56],[0.62,0.6],[0.73,0.6],[0.73,0.67],[0.8,0.67],[0.8,0.72],[0.65,0.72],[0.65,0.75],[0.35,0.75],[0.35,0.72],[0.23,0.72],[0.23,0.66],[0.29,0.66]],
              [[0.2,0.74],[0.38,0.72],[0.48,0.75],[0.82,0.73],[0.94,0.75],[0.94,1],[0.14,1],[0.14,0.78]]
            ]
          },
          {
            "kind": "recordCabinet",
            "x": 6.4533,
            "y": 5.8667,
            "w": 1.84,
            "h": 1.0667,
            "room": "hall",
            "baked": true,
            "depth": 6.9333
          },
          {
            "kind": "cakeTable",
            "x": 1.4667,
            "y": 9.7067,
            "w": 5.6,
            "h": 4.7733,
            "room": "hall",
            "baked": true,
            "depth": 14.4938,
            "occlusionShapes": [
              [[0.3714,0.0279],[0.4,0.0279],[0.4,0.1117],[0.481,0.1117],[0.481,0.0279],[0.5095,0.0279],[0.5095,0.1229],[0.5905,0.1229],[0.5905,0.0391],[0.6143,0.0391],[0.6143,0.1453],[0.6476,0.1732],[0.6476,0.2682],[0.6952,0.3128],[0.6952,0.4134],[0.7429,0.4469],[0.7857,0.486],[0.7857,0.7039],[0.7429,0.7598],[0.6667,0.7765],[0.2571,0.7765],[0.1952,0.7486],[0.1619,0.6983],[0.1619,0.4972],[0.2048,0.4525],[0.2333,0.4246],[0.2333,0.324],[0.281,0.2682],[0.281,0.1732],[0.3476,0.1117],[0.3714,0.1117]],
              [[0.1143,0.0615],[0.1381,0.0279],[0.1619,0.0615],[0.1762,0.0615],[0.1762,0.1397],[0.2095,0.1564],[0.2095,0.257],[0.2381,0.257],[0.2381,0.3799],[0.219,0.4134],[0.0476,0.4134],[0.0476,0.2626],[0.1143,0.2626]],
              [[0.0905,0.4693],[0.1714,0.4693],[0.1714,0.4916],[0.2238,0.4916],[0.2238,0.5363],[0.2714,0.5363],[0.2714,0.8045],[0.0667,0.8045],[0.0667,0.6592],[0.0476,0.6592],[0.0476,0.5084],[0.0905,0.5084]],
              [[0.2143,0.676],[0.2476,0.6592],[0.2952,0.6816],[0.3381,0.6536],[0.3857,0.676],[0.3857,0.7374],[0.3714,0.7654],[0.3714,0.9162],[0.1714,0.9162],[0.1714,0.7095],[0.2143,0.7095]],
              [[0.4286,0.7654],[0.4429,0.7151],[0.481,0.7039],[0.5143,0.7598],[0.5524,0.7039],[0.5857,0.7039],[0.6048,0.7709],[0.6048,0.9832],[0.3952,0.9832],[0.3952,0.7765]],
              [[0.6762,0.7095],[0.6762,0.6536],[0.7095,0.6369],[0.7571,0.7095],[0.7857,0.6369],[0.8143,0.6536],[0.8143,0.7039],[0.8524,0.7039],[0.8524,0.9385],[0.6333,0.9385],[0.6333,0.7151]],
              [[0.6952,0.2626],[0.7381,0.2626],[0.7381,0.2011],[0.7952,0.2011],[0.7952,0.2626],[0.8571,0.2626],[0.8571,0.4246],[0.7095,0.4246]],
              [[0.8238,0.4078],[0.8333,0.3464],[0.8714,0.3296],[0.8952,0.3799],[0.9333,0.3464],[0.9571,0.3799],[0.9571,0.4134],[0.9952,0.4134],[0.9952,0.5196],[0.819,0.5196]]
            ],
            "collisionRects": [
              {"x":0.9866,"y":2.1179,"w":3.1467,"h":1.6015},
              {"x":0.32,"y":2.8386,"w":0.96,"h":0.9609},
              {"x":0.9333,"y":3.1322,"w":1.2533,"h":1.2545},
              {"x":2.16,"y":3.5326,"w":1.0933,"h":1.2011},
              {"x":3.3333,"y":3.1589,"w":1.2,"h":1.2812},
              {"x":3.3866,"y":1.3972,"w":1.0933,"h":0.7741},
              {"x":4.32,"y":1.9577,"w":1.04,"h":0.6406},
              {"x":-0.0534,"y":1.2104,"w":1.3333,"h":0.9609}
            ]
          },
          {
            "kind": "cakeWhale",
            "room": "hall",
            "baked": true,
            "x": 5.28,
            "y": 11.5733,
            "w": 2.8533,
            "h": 2.2667,
            "depth": 13.8532,
            "occlusionShape": [[0.0654,0.1647],[0.1028,0.0706],[0.1963,0.0706],[0.2336,0.1294],[0.2897,0.0588],[0.3458,0],[0.4112,0.0471],[0.4112,0.1294],[0.3364,0.2235],[0.3084,0.2824],[0.5234,0.2471],[0.7477,0.2471],[0.8224,0.3294],[0.8598,0.4706],[0.9439,0.5059],[0.9813,0.6],[0.9439,0.7059],[0.8505,0.7059],[0.8505,0.8118],[0.757,0.8118],[0.757,0.8824],[0.5701,0.9294],[0.243,0.9294],[0.243,0.9882],[0.1121,0.9882],[0.1121,0.8824],[0.1682,0.8],[0.1028,0.7176],[0.0561,0.5647],[0.0093,0.5294],[0.0093,0.3412],[0.0654,0.3412]],
            "collisionRects": [
              {"x":0.2667,"y":0.6784,"w":2.5333,"h":1.4681},
              {"x":0,"y":0.9987,"w":0.5333,"h":0.7741},
              {"x":2.72,"y":1.1321,"w":0.4267,"h":0.8008}
            ]
          },
          {
            "kind": "cakeBalloons",
            "room": "hall",
            "baked": true,
            "x": 6.4,
            "y": 10.1333,
            "w": 2.56,
            "h": 3.1467,
            "depth": 13.6533,
            "occlusionShapes": [
              [[0.176042,0.028528],[0.355208,0.028528],[0.426875,0.072638],[0.480625,0.152034],[0.489583,0.315239],[0.444792,0.390225],[0.332812,0.4608],[0.265625,0.469622],[0.167083,0.438745],[0.086458,0.36817],[0.041667,0.284362],[0.041667,0.152034],[0.104375,0.072638]],
              [[0.51875,0.028528],[0.66875,0.028528],[0.72875,0.068396],[0.77375,0.140159],[0.78125,0.287671],[0.74375,0.355446],[0.65,0.419235],[0.59375,0.427209],[0.51125,0.399301],[0.44375,0.335512],[0.40625,0.259763],[0.40625,0.140159],[0.45875,0.068396]],
              [[0.434375,0.274523],[0.596875,0.274523],[0.661875,0.316087],[0.710625,0.390903],[0.71875,0.544692],[0.678125,0.615352],[0.576562,0.681855],[0.515625,0.690168],[0.42625,0.661073],[0.353125,0.59457],[0.3125,0.515597],[0.3125,0.390903],[0.369375,0.316087]],
              [[0.770833,0.325418],[0.895833,0.325418],[0.945833,0.363589],[0.983333,0.432298],[0.989583,0.573533],[0.958333,0.638425],[0.880208,0.699499],[0.833333,0.707133],[0.764583,0.680413],[0.708333,0.619339],[0.677083,0.546813],[0.677083,0.432298],[0.720833,0.363589]],
              [[0.25,0.444174],[0.270833,0.444174],[0.447917,0.851337],[0.572917,0.953128],[0.5625,0.970093],[0.427083,0.868302]],
              [[0.5,0.681686],[0.520833,0.681686],[0.53125,0.851337],[0.59375,0.953128],[0.572917,0.96161],[0.510417,0.85982]],
              [[0.84375,0.690168],[0.864583,0.690168],[0.760417,0.868302],[0.635417,0.970093],[0.614583,0.96161],[0.739583,0.851337]],
              [[0.6875,0.647755],[0.708333,0.647755],[0.65625,0.868302],[0.614583,0.96161],[0.59375,0.953128],[0.635417,0.851337]]
            ]
          },
          {
            "kind": "cakeBalloonBase",
            "room": "hall",
            "baked": true,
            "x": 7.573333,
            "y": 12.758818,
            "w": 0.666667,
            "h": 0.774071,
            "collision": {
              "x": 7.92,
              "y": 13.3333,
              "w": 0.4,
              "h": 0.32
            },
            "depth": 13.6533,
            "occlusionShapes": [
              [[0.08,0.068965],[0.24,0.034483],[0.4,0.137931],[0.44,0.206896],[0.4,0.37931],[0.28,0.448275],[0.04,0.413793],[0.0,0.275862]],
              [[0.6,0.068965],[0.8,0.034483],[0.92,0.103448],[0.96,0.241379],[0.88,0.37931],[0.72,0.413793],[0.56,0.310345]],
              [[0.4,0.206896],[0.48,0.206896],[0.52,0.344827],[0.44,0.37931],[0.36,0.310345]],
              [[0.36,0.37931],[0.48,0.37931],[0.48,0.586206],[0.36,0.689655],[0.32,0.862068],[0.24,0.931034],[0.08,0.965517],[0.04,0.862068],[0.08,0.75862],[0.0,0.689655],[0.04,0.586206],[0.2,0.517241]],
              [[0.52,0.37931],[0.64,0.413793],[0.68,0.551724],[0.8,0.551724],[0.8,0.655172],[0.88,0.724137],[0.84,0.793103],[0.72,0.862068],[0.6,0.827586],[0.56,0.724137],[0.52,0.620689],[0.44,0.586206]]
            ]
          },
          {
            "kind": "giftTable",
            "x": 33.813333,
            "y": 10.810296,
            "w": 4.586667,
            "h": 3.603432,
            "room": "hall",
            "baked": true,
            "collision": {"x":33.9467,"y":12.8267,"w":3.9733,"h":1.5733},
            "depth": 14.4,
            "occlusionShapes": [
              [[0.05233,0.36296],[0.09302,0.37778],[0.10465,0.45185],[0.14535,0.4963],[0.26163,0.51852],[0.30233,0.52593],[0.47093,0.52593],[0.48837,0.57037],[0.69186,0.57037],[0.7093,0.52593],[0.72093,0.52593],[0.72093,0.6963],[0.70349,0.6963],[0.70349,0.94074],[0.51163,0.94074],[0.51163,0.91111],[0.46512,0.91111],[0.43605,0.93333],[0.41279,0.93333],[0.39535,0.91111],[0.36047,0.92593],[0.31395,0.92593],[0.30233,0.91111],[0.26744,0.93333],[0.23256,0.93333],[0.21512,0.91111],[0.18023,0.92593],[0.12791,0.91111],[0.09884,0.92593],[0.05233,0.92593],[0.03488,0.8963],[0.03488,0.74074],[0.01163,0.71852],[0.0,0.64444],[0.01163,0.6],[0.03488,0.57037],[0.03488,0.43704]],
              [[0.13953,0.02222],[0.18023,0.02222],[0.19767,0.0],[0.23256,0.02222],[0.24419,0.05185],[0.27907,0.04444],[0.30814,0.07407],[0.32558,0.11852],[0.31977,0.15556],[0.34302,0.20741],[0.34302,0.25926],[0.31977,0.28889],[0.2907,0.3037],[0.28488,0.44444],[0.26163,0.5037],[0.22093,0.53333],[0.15116,0.52593],[0.11628,0.48889],[0.10465,0.44444],[0.10465,0.34815],[0.06395,0.33333],[0.03488,0.2963],[0.02326,0.24444],[0.05233,0.19259],[0.02907,0.15556],[0.0407,0.11111],[0.06977,0.08889],[0.0814,0.04444],[0.11047,0.03704]],
              [[0.3314,0.2],[0.36628,0.2],[0.39535,0.22963],[0.41279,0.20741],[0.44767,0.2],[0.46512,0.22963],[0.4593,0.28889],[0.47093,0.32593],[0.47093,0.53333],[0.29651,0.53333],[0.29651,0.32593],[0.31977,0.28889]],
              [[0.52326,0.21481],[0.55233,0.21481],[0.5814,0.24444],[0.61628,0.20741],[0.63953,0.22222],[0.66279,0.25926],[0.66279,0.3037],[0.69186,0.31852],[0.69767,0.57778],[0.47674,0.57778],[0.47674,0.31852],[0.50581,0.2963],[0.50581,0.25926]],
              [[0.5407,0.65185],[0.57558,0.65185],[0.60465,0.68889],[0.63953,0.65926],[0.68023,0.65926],[0.69767,0.6963],[0.7093,0.72593],[0.7093,0.95556],[0.50581,0.95556],[0.50581,0.72593],[0.52907,0.6963]],
              [[0.80814,0.12593],[0.84302,0.11111],[0.86628,0.16296],[0.86047,0.20741],[0.89535,0.20741],[0.9186,0.19259],[0.95349,0.22222],[0.96512,0.28148],[0.94767,0.31852],[0.98837,0.35556],[1.0,0.41481],[0.97093,0.45185],[0.98837,0.5037],[0.98256,0.55556],[0.95349,0.58519],[0.94767,0.77037],[0.91279,0.81481],[0.84302,0.84444],[0.7907,0.81481],[0.76744,0.77037],[0.76163,0.60741],[0.73256,0.57778],[0.72093,0.54074],[0.72674,0.4963],[0.70349,0.46667],[0.69767,0.42222],[0.72093,0.37778],[0.69767,0.33333],[0.72093,0.28148],[0.75,0.26667],[0.74419,0.22222],[0.77326,0.19259],[0.80814,0.2]]
            ]
          },
          {
            "kind": "giftWhaleBalloons",
            "x": 34.613333,
            "y": 7.473785,
            "w": 3.813333,
            "h": 4.244042,
            "room": "hall",
            "baked": true,
            "depth": 14.4,
            "occlusionShapes": [
              [[0.27972,0.24528],[0.30769,0.20755],[0.36364,0.18868],[0.3986,0.16352],[0.58741,0.16352],[0.58741,0.1761],[0.65035,0.18868],[0.67832,0.21384],[0.70629,0.24528],[0.74126,0.21384],[0.76573,0.18239],[0.74825,0.15094],[0.70629,0.12579],[0.6993,0.10063],[0.6993,0.02516],[0.72727,0.00629],[0.78322,0.00629],[0.81119,0.03145],[0.82517,0.0566],[0.84615,0.08805],[0.87413,0.06918],[0.94406,0.06918],[0.97203,0.08805],[0.99301,0.1195],[0.98601,0.15094],[0.95804,0.18239],[0.91608,0.20126],[0.86713,0.20126],[0.86014,0.30189],[0.83217,0.30189],[0.83217,0.35849],[0.8042,0.35849],[0.8042,0.40252],[0.77622,0.43396],[0.74825,0.45912],[0.70629,0.48428],[0.67832,0.50314],[0.70629,0.52201],[0.72028,0.54717],[0.72028,0.57862],[0.67133,0.59748],[0.62937,0.59748],[0.6014,0.57233],[0.58741,0.54717],[0.52448,0.54717],[0.52448,0.53459],[0.44755,0.53459],[0.41259,0.51572],[0.37063,0.49686],[0.34266,0.4717],[0.31469,0.44025],[0.28671,0.40881],[0.26573,0.36478],[0.26573,0.30189],[0.27972,0.27044]],
              [[0.2028,0.06289],[0.31469,0.06289],[0.34965,0.08805],[0.38462,0.10692],[0.40559,0.13836],[0.40559,0.1761],[0.37762,0.20755],[0.34266,0.22642],[0.3007,0.25157],[0.27972,0.28302],[0.26573,0.33962],[0.26573,0.40252],[0.21678,0.40252],[0.17483,0.38365],[0.13986,0.3522],[0.11189,0.30818],[0.11189,0.1761],[0.13986,0.13836],[0.13986,0.11321],[0.17483,0.08805]],
              [[0.05594,0.36478],[0.15385,0.36478],[0.18881,0.38994],[0.20979,0.42767],[0.21678,0.48428],[0.2028,0.5283],[0.17483,0.56604],[0.13986,0.59119],[0.13986,0.61635],[0.1049,0.6478],[0.09091,0.61635],[0.05594,0.61006],[0.02098,0.57862],[0.0,0.54717],[0.0,0.44654],[0.02098,0.40252]],
              [[0.21678,0.50314],[0.3007,0.50314],[0.34266,0.5283],[0.37063,0.55975],[0.39161,0.61006],[0.39161,0.66038],[0.37762,0.7044],[0.34965,0.73585],[0.31469,0.76101],[0.28671,0.77358],[0.28671,0.80503],[0.25175,0.81761],[0.22378,0.78616],[0.18881,0.7673],[0.16084,0.73585],[0.13986,0.69182],[0.13986,0.61006],[0.16783,0.55975],[0.1958,0.52201]],
              [[0.43357,0.54717],[0.53846,0.54717],[0.57343,0.56604],[0.60839,0.59748],[0.63636,0.63522],[0.63636,0.69811],[0.60839,0.74214],[0.57343,0.77358],[0.53846,0.79245],[0.52448,0.83019],[0.48951,0.84277],[0.46154,0.81132],[0.45455,0.79245],[0.40559,0.7673],[0.38462,0.73585],[0.37063,0.69182],[0.37063,0.61635],[0.3986,0.57862]],
              [[0.6993,0.58491],[0.78322,0.58491],[0.82517,0.61635],[0.85315,0.66038],[0.86014,0.71069],[0.83916,0.76101],[0.8042,0.80503],[0.76923,0.83648],[0.72028,0.84906],[0.68531,0.83648],[0.64336,0.80503],[0.61538,0.76101],[0.60839,0.71069],[0.62937,0.66667],[0.65035,0.63522],[0.67133,0.60377]],
              [[0.0979,0.64151],[0.11189,0.64151],[0.16783,0.72956],[0.21678,0.87421],[0.26573,0.97484],[0.25175,0.98742],[0.2028,0.8805],[0.15385,0.73585]],
              [[0.25874,0.80503],[0.27273,0.80503],[0.27273,0.90566],[0.28671,0.94969],[0.27273,0.98113],[0.25874,0.93711]],
              [[0.37063,0.71069],[0.38462,0.71069],[0.35664,0.83019],[0.32867,0.8805],[0.30769,0.94969],[0.28671,0.99371],[0.27273,0.98742],[0.29371,0.93711],[0.31469,0.87421],[0.34266,0.8239]],
              [[0.37762,0.73585],[0.39161,0.73585],[0.41958,0.86164],[0.46154,0.94969],[0.48951,0.98113],[0.47552,0.99371],[0.44755,0.96855],[0.40559,0.86792]],
              [[0.48951,0.83019],[0.5035,0.83019],[0.4965,0.93082],[0.51049,0.97484],[0.4965,0.98742],[0.48252,0.9434]],
              [[0.68531,0.84906],[0.70629,0.84906],[0.70629,0.88679],[0.66434,0.92453],[0.64336,0.97484],[0.62937,1.0],[0.61538,0.98742],[0.62937,0.93082],[0.68531,0.8805]]
            ]
          },
          {
            "kind": "ringToss",
            "x": 1.2533,
            "y": 14.6806,
            "w": 5.12,
            "h": 7.0734,
            "room": "hall",
            "baked": true,
            "depth": 21.7541,
            "collisionRects": [
              {"x":0.5067,"y":3.3633,"w":4.2133,"h":3.2297},
              {"x":0.3467,"y":6.4595,"w":0.4,"h":0.5338},
              {"x":4.5067,"y":6.4061,"w":0.56,"h":0.6673}
            ],
            "occlusionShapes": [
              [[0.0885,0.1585],[0.2292,0.1094],[0.3281,0.1359],[0.8125,0.1359],[0.9063,0.0528],[0.9063,0.3925],[0.849,0.4566],[0.7865,0.4566],[0.7448,0.4264],[0.6927,0.4491],[0.6094,0.434],[0.5729,0.4604],[0.5156,0.4415],[0.4688,0.4566],[0.4167,0.4453],[0.349,0.4642],[0.3073,0.4491],[0.2552,0.4604],[0.2031,0.4491],[0.1302,0.4604],[0.0781,0.4491]],
              [[0.0938,0.4566],[0.9063,0.4566],[0.9063,0.951],[0.0938,0.951]],
              [[0.0625,0.2717],[0.1302,0.2717],[0.1302,0.9774],[0.0625,0.9774]],
              [[0.8698,0.283],[0.9479,0.283],[0.9479,0.9962],[0.8698,0.9962]],
              [[0.9063,0.0302],[0.9948,0.0302],[0.9948,0.9925],[0.9063,0.9925]]
            ]
          },
          {
            "kind": "ringTray",
            "x": 5.733333,
            "y": 19.405148,
            "w": 1.706667,
            "h": 2.028599,
            "room": "hall",
            "baked": true,
            "collision": {
              "x": 5.8133,
              "y": 20.4267,
              "w": 1.5467,
              "h": 0.88
            },
            "depth": 21.3067,
            "occlusionShapes": [
              [[0.515625,0.026316],[0.59375,-0.0],[0.640625,0.052631],[0.5625,0.157895],[0.515625,0.263158],[0.5,0.302631],[0.4375,0.315789],[0.453125,0.18421]],
              [[0.109375,0.197368],[0.734375,0.197368],[0.734375,0.144737],[0.84375,0.144737],[0.9375,0.18421],[0.984375,0.25],[0.9375,0.394737],[0.953125,0.421052],[0.953125,0.789473],[0.890625,0.828947],[0.890625,0.947368],[0.8125,0.947368],[0.796875,0.868421],[0.21875,0.868421],[0.203125,0.960526],[0.09375,0.960526],[0.09375,0.855263],[0.03125,0.815789],[0.03125,0.302631]]
            ]
          },
          {
            "kind": "fishing",
            "x": 34.0267,
            "y": 14.4137,
            "w": 4.8,
            "h": 7.4738,
            "room": "hall",
            "baked": true,
            "depth": 21.8875,
            "collisionRects": [
              {"x":0.4533,"y":3.7636,"w":3.8933,"h":3.2831},
              {"x":0.0266,"y":6.5396,"w":0.4533,"h":0.8008},
              {"x":4.2933,"y":6.8065,"w":0.4533,"h":0.6139}
            ],
            "occlusionShapes": [
              [[0.05,0.1214],[0.1778,0.15],[0.2722,0.1393],[0.7444,0.1357],[0.8778,0.0821],[0.9,0.3786],[0.8278,0.4607],[0.7722,0.4464],[0.7055,0.4786],[0.6333,0.4536],[0.5667,0.475],[0.4833,0.45],[0.4111,0.4679],[0.3389,0.45],[0.2667,0.4714],[0.1889,0.4393],[0.1111,0.4643],[0.0555,0.4321]],
              [[0.0778,0.475],[0.9167,0.475],[0.9167,0.9607],[0.0778,0.9607]],
              [[0.0055,0.0071],[0.0944,0.0071],[0.0944,0.9857],[0.0055,0.9857]],
              [[0.8889,0.2607],[0.9944,0.2607],[0.9944,0.9929],[0.8889,0.9929]]
            ]
          },
          {
            "kind": "chair",
            "x": 11.0933,
            "y": 11.8133,
            "w": 1.52,
            "h": 1.8133,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.0534,
                "y": 1.04,
                "w": 1.4133,
                "h": 0.375
              },
              {
                "x": 0.0534,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              },
              {
                "x": 1.2167,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              }
            ],
            "depth": 13.6267,
            "occlusionShape": [
              [
                0.12,
                0
              ],
              [
                0.88,
                0
              ],
              [
                1,
                0.14
              ],
              [
                1,
                0.9
              ],
              [
                0.88,
                1
              ],
              [
                0.75,
                1
              ],
              [
                0.75,
                0.85
              ],
              [
                0.25,
                0.85
              ],
              [
                0.25,
                1
              ],
              [
                0.12,
                1
              ],
              [
                0,
                0.9
              ],
              [
                0,
                0.14
              ]
            ],
            "facing": "north"
          },
          {
            "kind": "chair",
            "x": 13.5733,
            "y": 11.8133,
            "w": 1.52,
            "h": 1.8133,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.0534,
                "y": 1.04,
                "w": 1.4133,
                "h": 0.375
              },
              {
                "x": 0.0534,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              },
              {
                "x": 1.2167,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              }
            ],
            "depth": 13.6267,
            "occlusionShape": [
              [
                0.12,
                0
              ],
              [
                0.88,
                0
              ],
              [
                1,
                0.14
              ],
              [
                1,
                0.9
              ],
              [
                0.88,
                1
              ],
              [
                0.75,
                1
              ],
              [
                0.75,
                0.85
              ],
              [
                0.25,
                0.85
              ],
              [
                0.25,
                1
              ],
              [
                0.12,
                1
              ],
              [
                0,
                0.9
              ],
              [
                0,
                0.14
              ]
            ],
            "facing": "north"
          },
          {
            "kind": "chair",
            "x": 16.1067,
            "y": 11.8133,
            "w": 1.52,
            "h": 1.8133,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.0533,
                "y": 1.04,
                "w": 1.4133,
                "h": 0.375
              },
              {
                "x": 0.0533,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              },
              {
                "x": 1.2166,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              }
            ],
            "depth": 13.6267,
            "occlusionShape": [
              [
                0.12,
                0
              ],
              [
                0.88,
                0
              ],
              [
                1,
                0.14
              ],
              [
                1,
                0.9
              ],
              [
                0.88,
                1
              ],
              [
                0.75,
                1
              ],
              [
                0.75,
                0.85
              ],
              [
                0.25,
                0.85
              ],
              [
                0.25,
                1
              ],
              [
                0.12,
                1
              ],
              [
                0,
                0.9
              ],
              [
                0,
                0.14
              ]
            ],
            "facing": "north"
          },
          {
            "kind": "chair",
            "x": 22.2933,
            "y": 11.8133,
            "w": 1.52,
            "h": 1.8133,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.0534,
                "y": 1.04,
                "w": 1.4133,
                "h": 0.375
              },
              {
                "x": 0.0534,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              },
              {
                "x": 1.2167,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              }
            ],
            "depth": 13.6267,
            "occlusionShape": [
              [
                0.12,
                0
              ],
              [
                0.88,
                0
              ],
              [
                1,
                0.14
              ],
              [
                1,
                0.9
              ],
              [
                0.88,
                1
              ],
              [
                0.75,
                1
              ],
              [
                0.75,
                0.85
              ],
              [
                0.25,
                0.85
              ],
              [
                0.25,
                1
              ],
              [
                0.12,
                1
              ],
              [
                0,
                0.9
              ],
              [
                0,
                0.14
              ]
            ],
            "facing": "north"
          },
          {
            "kind": "chair",
            "x": 24.7733,
            "y": 11.8133,
            "w": 1.52,
            "h": 1.8133,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.0534,
                "y": 1.04,
                "w": 1.4133,
                "h": 0.375
              },
              {
                "x": 0.0534,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              },
              {
                "x": 1.2167,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              }
            ],
            "depth": 13.6267,
            "occlusionShape": [
              [
                0.12,
                0
              ],
              [
                0.88,
                0
              ],
              [
                1,
                0.14
              ],
              [
                1,
                0.9
              ],
              [
                0.88,
                1
              ],
              [
                0.75,
                1
              ],
              [
                0.75,
                0.85
              ],
              [
                0.25,
                0.85
              ],
              [
                0.25,
                1
              ],
              [
                0.12,
                1
              ],
              [
                0,
                0.9
              ],
              [
                0,
                0.14
              ]
            ],
            "facing": "north"
          },
          {
            "kind": "chair",
            "x": 27.3867,
            "y": 11.8133,
            "w": 1.52,
            "h": 1.8133,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.0533,
                "y": 1.04,
                "w": 1.4133,
                "h": 0.375
              },
              {
                "x": 0.0533,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              },
              {
                "x": 1.2166,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              }
            ],
            "depth": 13.6267,
            "occlusionShape": [
              [
                0.12,
                0
              ],
              [
                0.88,
                0
              ],
              [
                1,
                0.14
              ],
              [
                1,
                0.9
              ],
              [
                0.88,
                1
              ],
              [
                0.75,
                1
              ],
              [
                0.75,
                0.85
              ],
              [
                0.25,
                0.85
              ],
              [
                0.25,
                1
              ],
              [
                0.12,
                1
              ],
              [
                0,
                0.9
              ],
              [
                0,
                0.14
              ]
            ],
            "facing": "north"
          },
          {
            "kind": "chair",
            "x": 11.0933,
            "y": 13.9733,
            "w": 1.52,
            "h": 1.8133,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.0534,
                "y": 1.04,
                "w": 1.4133,
                "h": 0.375
              },
              {
                "x": 0.0534,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              },
              {
                "x": 1.2167,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              }
            ],
            "depth": 15.7867,
            "occlusionShape": [
              [
                0.12,
                0
              ],
              [
                0.88,
                0
              ],
              [
                1,
                0.14
              ],
              [
                1,
                0.9
              ],
              [
                0.88,
                1
              ],
              [
                0.75,
                1
              ],
              [
                0.75,
                0.85
              ],
              [
                0.25,
                0.85
              ],
              [
                0.25,
                1
              ],
              [
                0.12,
                1
              ],
              [
                0,
                0.9
              ],
              [
                0,
                0.14
              ]
            ],
            "facing": "north"
          },
          {
            "kind": "chair",
            "x": 13.5733,
            "y": 13.9733,
            "w": 1.52,
            "h": 1.8133,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.0534,
                "y": 1.04,
                "w": 1.4133,
                "h": 0.375
              },
              {
                "x": 0.0534,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              },
              {
                "x": 1.2167,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              }
            ],
            "depth": 15.7867,
            "occlusionShape": [
              [
                0.12,
                0
              ],
              [
                0.88,
                0
              ],
              [
                1,
                0.14
              ],
              [
                1,
                0.9
              ],
              [
                0.88,
                1
              ],
              [
                0.75,
                1
              ],
              [
                0.75,
                0.85
              ],
              [
                0.25,
                0.85
              ],
              [
                0.25,
                1
              ],
              [
                0.12,
                1
              ],
              [
                0,
                0.9
              ],
              [
                0,
                0.14
              ]
            ],
            "facing": "north"
          },
          {
            "kind": "chair",
            "x": 16.1067,
            "y": 13.9733,
            "w": 1.52,
            "h": 1.8133,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.0533,
                "y": 1.04,
                "w": 1.4133,
                "h": 0.375
              },
              {
                "x": 0.0533,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              },
              {
                "x": 1.2166,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              }
            ],
            "depth": 15.7867,
            "occlusionShape": [
              [
                0.12,
                0
              ],
              [
                0.88,
                0
              ],
              [
                1,
                0.14
              ],
              [
                1,
                0.9
              ],
              [
                0.88,
                1
              ],
              [
                0.75,
                1
              ],
              [
                0.75,
                0.85
              ],
              [
                0.25,
                0.85
              ],
              [
                0.25,
                1
              ],
              [
                0.12,
                1
              ],
              [
                0,
                0.9
              ],
              [
                0,
                0.14
              ]
            ],
            "facing": "north"
          },
          {
            "kind": "chair",
            "x": 22.2933,
            "y": 13.9733,
            "w": 1.52,
            "h": 1.8133,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.0534,
                "y": 1.04,
                "w": 1.4133,
                "h": 0.375
              },
              {
                "x": 0.0534,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              },
              {
                "x": 1.2167,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              }
            ],
            "depth": 15.7867,
            "occlusionShape": [
              [
                0.12,
                0
              ],
              [
                0.88,
                0
              ],
              [
                1,
                0.14
              ],
              [
                1,
                0.9
              ],
              [
                0.88,
                1
              ],
              [
                0.75,
                1
              ],
              [
                0.75,
                0.85
              ],
              [
                0.25,
                0.85
              ],
              [
                0.25,
                1
              ],
              [
                0.12,
                1
              ],
              [
                0,
                0.9
              ],
              [
                0,
                0.14
              ]
            ],
            "facing": "north"
          },
          {
            "kind": "chair",
            "x": 24.7733,
            "y": 13.9733,
            "w": 1.52,
            "h": 1.8133,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.0534,
                "y": 1.04,
                "w": 1.4133,
                "h": 0.375
              },
              {
                "x": 0.0534,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              },
              {
                "x": 1.2167,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              }
            ],
            "depth": 15.7867,
            "occlusionShape": [
              [
                0.12,
                0
              ],
              [
                0.88,
                0
              ],
              [
                1,
                0.14
              ],
              [
                1,
                0.9
              ],
              [
                0.88,
                1
              ],
              [
                0.75,
                1
              ],
              [
                0.75,
                0.85
              ],
              [
                0.25,
                0.85
              ],
              [
                0.25,
                1
              ],
              [
                0.12,
                1
              ],
              [
                0,
                0.9
              ],
              [
                0,
                0.14
              ]
            ],
            "facing": "north"
          },
          {
            "kind": "chair",
            "x": 27.3867,
            "y": 13.9733,
            "w": 1.52,
            "h": 1.8133,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.0533,
                "y": 1.04,
                "w": 1.4133,
                "h": 0.375
              },
              {
                "x": 0.0533,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              },
              {
                "x": 1.2166,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              }
            ],
            "depth": 15.7867,
            "occlusionShape": [
              [
                0.12,
                0
              ],
              [
                0.88,
                0
              ],
              [
                1,
                0.14
              ],
              [
                1,
                0.9
              ],
              [
                0.88,
                1
              ],
              [
                0.75,
                1
              ],
              [
                0.75,
                0.85
              ],
              [
                0.25,
                0.85
              ],
              [
                0.25,
                1
              ],
              [
                0.12,
                1
              ],
              [
                0,
                0.9
              ],
              [
                0,
                0.14
              ]
            ],
            "facing": "north"
          },
          {
            "kind": "chair",
            "x": 11.0933,
            "y": 16.2133,
            "w": 1.52,
            "h": 1.8133,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.0534,
                "y": 1.04,
                "w": 1.4133,
                "h": 0.375
              },
              {
                "x": 0.0534,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              },
              {
                "x": 1.2167,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              }
            ],
            "depth": 18.0267,
            "occlusionShape": [
              [
                0.12,
                0
              ],
              [
                0.88,
                0
              ],
              [
                1,
                0.14
              ],
              [
                1,
                0.9
              ],
              [
                0.88,
                1
              ],
              [
                0.75,
                1
              ],
              [
                0.75,
                0.85
              ],
              [
                0.25,
                0.85
              ],
              [
                0.25,
                1
              ],
              [
                0.12,
                1
              ],
              [
                0,
                0.9
              ],
              [
                0,
                0.14
              ]
            ],
            "facing": "north"
          },
          {
            "kind": "chair",
            "x": 13.5733,
            "y": 16.2133,
            "w": 1.52,
            "h": 1.8133,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.0534,
                "y": 1.04,
                "w": 1.4133,
                "h": 0.375
              },
              {
                "x": 0.0534,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              },
              {
                "x": 1.2167,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              }
            ],
            "depth": 18.0267,
            "occlusionShape": [
              [
                0.12,
                0
              ],
              [
                0.88,
                0
              ],
              [
                1,
                0.14
              ],
              [
                1,
                0.9
              ],
              [
                0.88,
                1
              ],
              [
                0.75,
                1
              ],
              [
                0.75,
                0.85
              ],
              [
                0.25,
                0.85
              ],
              [
                0.25,
                1
              ],
              [
                0.12,
                1
              ],
              [
                0,
                0.9
              ],
              [
                0,
                0.14
              ]
            ],
            "facing": "north"
          },
          {
            "kind": "chair",
            "x": 16.1067,
            "y": 16.2133,
            "w": 1.52,
            "h": 1.8133,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.0533,
                "y": 1.04,
                "w": 1.4133,
                "h": 0.375
              },
              {
                "x": 0.0533,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              },
              {
                "x": 1.2166,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              }
            ],
            "depth": 18.0267,
            "occlusionShape": [
              [
                0.12,
                0
              ],
              [
                0.88,
                0
              ],
              [
                1,
                0.14
              ],
              [
                1,
                0.9
              ],
              [
                0.88,
                1
              ],
              [
                0.75,
                1
              ],
              [
                0.75,
                0.85
              ],
              [
                0.25,
                0.85
              ],
              [
                0.25,
                1
              ],
              [
                0.12,
                1
              ],
              [
                0,
                0.9
              ],
              [
                0,
                0.14
              ]
            ],
            "facing": "north"
          },
          {
            "kind": "chair",
            "x": 22.2933,
            "y": 16.2133,
            "w": 1.52,
            "h": 1.8133,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.0534,
                "y": 1.04,
                "w": 1.4133,
                "h": 0.375
              },
              {
                "x": 0.0534,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              },
              {
                "x": 1.2167,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              }
            ],
            "depth": 18.0267,
            "occlusionShape": [
              [
                0.12,
                0
              ],
              [
                0.88,
                0
              ],
              [
                1,
                0.14
              ],
              [
                1,
                0.9
              ],
              [
                0.88,
                1
              ],
              [
                0.75,
                1
              ],
              [
                0.75,
                0.85
              ],
              [
                0.25,
                0.85
              ],
              [
                0.25,
                1
              ],
              [
                0.12,
                1
              ],
              [
                0,
                0.9
              ],
              [
                0,
                0.14
              ]
            ],
            "facing": "north"
          },
          {
            "kind": "chair",
            "x": 24.7733,
            "y": 16.2133,
            "w": 1.52,
            "h": 1.8133,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.0534,
                "y": 1.04,
                "w": 1.4133,
                "h": 0.375
              },
              {
                "x": 0.0534,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              },
              {
                "x": 1.2167,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              }
            ],
            "depth": 18.0267,
            "occlusionShape": [
              [
                0.12,
                0
              ],
              [
                0.88,
                0
              ],
              [
                1,
                0.14
              ],
              [
                1,
                0.9
              ],
              [
                0.88,
                1
              ],
              [
                0.75,
                1
              ],
              [
                0.75,
                0.85
              ],
              [
                0.25,
                0.85
              ],
              [
                0.25,
                1
              ],
              [
                0.12,
                1
              ],
              [
                0,
                0.9
              ],
              [
                0,
                0.14
              ]
            ],
            "facing": "north"
          },
          {
            "kind": "chair",
            "x": 27.3867,
            "y": 16.2133,
            "w": 1.52,
            "h": 1.8133,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.0533,
                "y": 1.04,
                "w": 1.4133,
                "h": 0.375
              },
              {
                "x": 0.0533,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              },
              {
                "x": 1.2166,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              }
            ],
            "depth": 18.0267,
            "occlusionShape": [
              [
                0.12,
                0
              ],
              [
                0.88,
                0
              ],
              [
                1,
                0.14
              ],
              [
                1,
                0.9
              ],
              [
                0.88,
                1
              ],
              [
                0.75,
                1
              ],
              [
                0.75,
                0.85
              ],
              [
                0.25,
                0.85
              ],
              [
                0.25,
                1
              ],
              [
                0.12,
                1
              ],
              [
                0,
                0.9
              ],
              [
                0,
                0.14
              ]
            ],
            "facing": "north"
          },
          {
            "kind": "chair",
            "x": 11.0933,
            "y": 18.4267,
            "w": 1.52,
            "h": 1.8133,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.0534,
                "y": 1.04,
                "w": 1.4133,
                "h": 0.375
              },
              {
                "x": 0.0534,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              },
              {
                "x": 1.2167,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              }
            ],
            "depth": 20.24,
            "occlusionShape": [
              [
                0.12,
                0
              ],
              [
                0.88,
                0
              ],
              [
                1,
                0.14
              ],
              [
                1,
                0.9
              ],
              [
                0.88,
                1
              ],
              [
                0.75,
                1
              ],
              [
                0.75,
                0.85
              ],
              [
                0.25,
                0.85
              ],
              [
                0.25,
                1
              ],
              [
                0.12,
                1
              ],
              [
                0,
                0.9
              ],
              [
                0,
                0.14
              ]
            ],
            "facing": "north"
          },
          {
            "kind": "chair",
            "x": 13.5733,
            "y": 18.4267,
            "w": 1.52,
            "h": 1.8133,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.0534,
                "y": 1.04,
                "w": 1.4133,
                "h": 0.375
              },
              {
                "x": 0.0534,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              },
              {
                "x": 1.2167,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              }
            ],
            "depth": 20.24,
            "occlusionShape": [
              [
                0.12,
                0
              ],
              [
                0.88,
                0
              ],
              [
                1,
                0.14
              ],
              [
                1,
                0.9
              ],
              [
                0.88,
                1
              ],
              [
                0.75,
                1
              ],
              [
                0.75,
                0.85
              ],
              [
                0.25,
                0.85
              ],
              [
                0.25,
                1
              ],
              [
                0.12,
                1
              ],
              [
                0,
                0.9
              ],
              [
                0,
                0.14
              ]
            ],
            "facing": "north"
          },
          {
            "kind": "chair",
            "x": 16.1067,
            "y": 18.4267,
            "w": 1.52,
            "h": 1.8133,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.0533,
                "y": 1.04,
                "w": 1.4133,
                "h": 0.375
              },
              {
                "x": 0.0533,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              },
              {
                "x": 1.2166,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              }
            ],
            "depth": 20.24,
            "occlusionShape": [
              [
                0.12,
                0
              ],
              [
                0.88,
                0
              ],
              [
                1,
                0.14
              ],
              [
                1,
                0.9
              ],
              [
                0.88,
                1
              ],
              [
                0.75,
                1
              ],
              [
                0.75,
                0.85
              ],
              [
                0.25,
                0.85
              ],
              [
                0.25,
                1
              ],
              [
                0.12,
                1
              ],
              [
                0,
                0.9
              ],
              [
                0,
                0.14
              ]
            ],
            "facing": "north"
          },
          {
            "kind": "chair",
            "x": 22.2933,
            "y": 18.4267,
            "w": 1.52,
            "h": 1.8133,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.0534,
                "y": 1.04,
                "w": 1.4133,
                "h": 0.375
              },
              {
                "x": 0.0534,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              },
              {
                "x": 1.2167,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              }
            ],
            "depth": 20.24,
            "occlusionShape": [
              [
                0.12,
                0
              ],
              [
                0.88,
                0
              ],
              [
                1,
                0.14
              ],
              [
                1,
                0.9
              ],
              [
                0.88,
                1
              ],
              [
                0.75,
                1
              ],
              [
                0.75,
                0.85
              ],
              [
                0.25,
                0.85
              ],
              [
                0.25,
                1
              ],
              [
                0.12,
                1
              ],
              [
                0,
                0.9
              ],
              [
                0,
                0.14
              ]
            ],
            "facing": "north"
          },
          {
            "kind": "chair",
            "x": 24.7733,
            "y": 18.4267,
            "w": 1.52,
            "h": 1.8133,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.0534,
                "y": 1.04,
                "w": 1.4133,
                "h": 0.375
              },
              {
                "x": 0.0534,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              },
              {
                "x": 1.2167,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              }
            ],
            "depth": 20.24,
            "occlusionShape": [
              [
                0.12,
                0
              ],
              [
                0.88,
                0
              ],
              [
                1,
                0.14
              ],
              [
                1,
                0.9
              ],
              [
                0.88,
                1
              ],
              [
                0.75,
                1
              ],
              [
                0.75,
                0.85
              ],
              [
                0.25,
                0.85
              ],
              [
                0.25,
                1
              ],
              [
                0.12,
                1
              ],
              [
                0,
                0.9
              ],
              [
                0,
                0.14
              ]
            ],
            "facing": "north"
          },
          {
            "kind": "chair",
            "x": 27.3867,
            "y": 18.4267,
            "w": 1.52,
            "h": 1.8133,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.0533,
                "y": 1.04,
                "w": 1.4133,
                "h": 0.375
              },
              {
                "x": 0.0533,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              },
              {
                "x": 1.2166,
                "y": 1.415,
                "w": 0.25,
                "h": 0.3983
              }
            ],
            "depth": 20.24,
            "occlusionShape": [
              [
                0.12,
                0
              ],
              [
                0.88,
                0
              ],
              [
                1,
                0.14
              ],
              [
                1,
                0.9
              ],
              [
                0.88,
                1
              ],
              [
                0.75,
                1
              ],
              [
                0.75,
                0.85
              ],
              [
                0.25,
                0.85
              ],
              [
                0.25,
                1
              ],
              [
                0.12,
                1
              ],
              [
                0,
                0.9
              ],
              [
                0,
                0.14
              ]
            ],
            "facing": "north"
          },
          {
            "kind": "storagePost",
            "x": 8.4267,
            "y": 0.0,
            "w": 1.0933,
            "h": 10.2667,
            "room": "hall",
            "baked": true,
            "collision": {
              "x": 8.4533,
              "y": 0.0,
              "w": 1.0667,
              "h": 10.2133
            },
            "depth": 10.2133
          },
          {
            "kind": "storageSouthWall",
            "x": 1.2,
            "y": 7.44,
            "w": 4.3733,
            "h": 2.0533,
            "room": "hall",
            "baked": true,
            "depth": 9.6625,
            "occlusionShapes": [
              [[0,0.0295],[0.9329,0.0295],[0.9329,1.0694],[0.0122,1.0694],[0.0122,0.8744],[0,0.8744]]
            ],
            "collision": {
              "x": 1.2533,
              "y": 7.5272,
              "w": 4.0267,
              "h": 2.1087
            }
          },
          {
            "kind": "storageEntryPost",
            "x": 5.28,
            "y": 7.1268,
            "w": 0.64,
            "h": 2.5624,
            "room": "hall",
            "baked": true,
            "depth": 9.6892,
            "occlusionShapes": [
              [[0.1667,0.0208],[0.7083,0.0208],[0.9167,0.1042],[0.9167,0.9792],[0.0833,0.9792],[0.0833,0.1146]]
            ],
            "collision": {
              "x": 5.3333,
              "y": 7.5272,
              "w": 0.4267,
              "h": 2.1354
            }
          },
          {
            "kind": "entryPostLeft",
            "x": 16.5867,
            "y": 22.3467,
            "w": 0.9333,
            "h": 2.6933,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.1783,
                "y": 1.0933,
                "w": 0.6033,
                "h": 1.225
              },
              {
                "x": 0.0533,
                "y": 2.3183,
                "w": 0.8533,
                "h": 0.375
              }
            ],
            "depth": 25.04
          },
          {
            "kind": "entryPostRight",
            "x": 22.5333,
            "y": 22.3467,
            "w": 0.9867,
            "h": 2.6933,
            "room": "hall",
            "baked": true,
            "collisionRects": [
              {
                "x": 0.1784,
                "y": 1.0933,
                "w": 0.6567,
                "h": 1.225
              },
              {
                "x": 0.0534,
                "y": 2.3183,
                "w": 0.9067,
                "h": 0.375
              }
            ],
            "depth": 25.04
          },
          {
            "kind": "stageFrontLeft",
            "x": 9.36,
            "y": 8.2133,
            "w": 8.8267,
            "h": 2.1867,
            "room": "hall",
            "baked": true,
            "collision": {
              "x": 9.4133,
              "y": 8.56,
              "w": 8.72,
              "h": 1.76
            },
            "depth": 10.32,
            "occlusionShape": [[0,0.1585],[1,0.1585],[1,1],[0,1]]
          },
          {
            "kind": "stageFrontRight",
            "x": 22,
            "y": 8.2133,
            "w": 8.8533,
            "h": 2.1867,
            "room": "hall",
            "baked": true,
            "collision": {
              "x": 22.0533,
              "y": 8.56,
              "w": 8.7467,
              "h": 1.76
            },
            "depth": 10.32,
            "occlusionShape": [[0,0.1585],[1,0.1585],[1,1],[0,1]]
          },
          {
            "kind": "plantStorage",
            "x": 5.2,
            "y": 8.247855,
            "w": 1.333333,
            "h": 2.215443,
            "room": "hall",
            "baked": true,
            "depth": 10.4099,
            "occlusionShapes": [
              [[0.45,0.0],[0.64,0.02],[0.66,0.12],[0.8,0.12],[0.9,0.2],[0.88,0.27],[0.97,0.32],[1.0,0.43],[0.88,0.48],[0.9,0.59],[0.76,0.64],[0.74,0.76],[0.75,0.83],[0.67,0.96],[0.3,0.98],[0.2,0.92],[0.14,0.8],[0.15,0.7],[0.05,0.65],[0.06,0.54],[0.0,0.49],[0.02,0.4],[0.13,0.34],[0.07,0.27],[0.14,0.2],[0.28,0.19],[0.28,0.09],[0.42,0.08]]
            ],
            "collision": {
              "x": 5.6,
              "y": 9.3155,
              "w": 0.7733,
              "h": 1.0677
            }
          },
          {
            "kind": "plantStage",
            "x": 30.506667,
            "y": 7.527169,
            "w": 1.253333,
            "h": 2.188751,
            "room": "hall",
            "baked": true,
            "collision": {
              "x": 30.72,
              "y": 9.3333,
              "w": 1.0933,
              "h": 0.9333
            },
            "depth": 10.2667,
            "occlusionShapes": [
              [[0.45,-0.0],[0.64,0.02],[0.66,0.12],[0.8,0.12],[0.9,0.2],[0.88,0.27],[0.97,0.32],[1.0,0.43],[0.88,0.48],[0.9,0.59],[0.76,0.64],[0.74,0.76],[0.75,0.83],[0.67,0.96],[0.3,0.98],[0.2,0.92],[0.14,0.8],[0.15,0.7],[0.05,0.65],[0.06,0.54],[-0.0,0.49],[0.02,0.4],[0.13,0.34],[0.07,0.27],[0.14,0.2],[0.28,0.19],[0.28,0.09],[0.42,0.08]]
            ]
          },
          {
            "kind": "plantRight",
            "x": 35.813333,
            "y": 3.443279,
            "w": 1.333333,
            "h": 3.016206,
            "room": "hall",
            "baked": true,
            "collision": {
              "x": 35.92,
              "y": 5.3867,
              "w": 1.0933,
              "h": 1.0133
            },
            "depth": 6.4,
            "occlusionShapes": [
              [[0.45,0.0],[0.64,0.02],[0.66,0.12],[0.8,0.12],[0.9,0.2],[0.88,0.27],[0.97,0.32],[1.000001,0.43],[0.88,0.48],[0.9,0.59],[0.76,0.64],[0.74,0.76],[0.75,0.83],[0.67,0.96],[0.3,0.98],[0.2,0.92],[0.14,0.8],[0.15,0.7],[0.05,0.65],[0.06,0.54],[0.0,0.49],[0.02,0.4],[0.13,0.34],[0.07,0.27],[0.14,0.2],[0.28,0.19],[0.28,0.09],[0.42,0.08]]
            ]
          },
          {
            "kind": "plantSouthWest",
            "room": "hall",
            "baked": true,
            "x": 0.346667,
            "y": 21.166826,
            "w": 1.52,
            "h": 2.028599,
            "collision": {
              "x": 0.8,
              "y": 22.4,
              "w": 0.88,
              "h": 0.7467
            },
            "depth": 23.1467,
            "occlusionShapes": [
              [[0.45,-0.0],[0.64,0.02],[0.66,0.12],[0.8,0.12],[0.9,0.2],[0.88,0.27],[0.97,0.32],[1.0,0.43],[0.88,0.48],[0.9,0.59],[0.76,0.64],[0.74,0.76],[0.75,0.83],[0.67,0.96],[0.3,0.98],[0.2,0.92],[0.14,0.8],[0.15,0.7],[0.05,0.65],[0.06,0.54],[-0.0,0.49],[0.02,0.4],[0.13,0.34],[0.07,0.27],[0.14,0.2],[0.28,0.19],[0.28,0.09],[0.42,0.08]]
            ]
          },
          {
            "kind": "plantSouthEast",
            "room": "hall",
            "baked": true,
            "x": 38.24,
            "y": 21.113441,
            "w": 1.386667,
            "h": 2.108675,
            "collision": {
              "x": 38.5067,
              "y": 22.4267,
              "w": 0.8,
              "h": 0.72
            },
            "depth": 23.1467,
            "occlusionShapes": [
              [[0.45,0.0],[0.64,0.02],[0.66,0.12],[0.8,0.12],[0.9,0.2],[0.88,0.27],[0.97,0.32],[1.0,0.43],[0.88,0.48],[0.9,0.59],[0.76,0.64],[0.74,0.76],[0.75,0.83],[0.67,0.96],[0.3,0.98],[0.2,0.92],[0.14,0.8],[0.15,0.7],[0.05,0.65],[0.06,0.54],[0.0,0.49],[0.02,0.4],[0.13,0.34],[0.07,0.27],[0.14,0.2],[0.28,0.19],[0.28,0.09],[0.42,0.08]]
            ]
          },
          {
            "kind": "ringStool",
            "room": "hall",
            "baked": true,
            "x": 1.7867,
            "y": 20.7733,
            "w": 1.12,
            "h": 1.3867,
            "collisionRects": [
              {"x":0.08,"y":0,"w":0.96,"h":0.85},
              {"x":0.08,"y":0.85,"w":0.2,"h":0.5367},
              {"x":0.84,"y":0.85,"w":0.2,"h":0.5367}
            ],
            "depth": 22.16,
            "occlusionShape": [[0.2,0],[0.8,0],[1,0.2],[1,0.9],[0.8,1],[0.7,1],[0.7,0.6],[0.3,0.6],[0.3,1],[0.1,1],[0,0.3]]
          },
          {
            "kind": "fishingStoolWest",
            "room": "hall",
            "baked": true,
            "x": 32.96,
            "y": 20.019066,
            "w": 1.146667,
            "h": 1.387989,
            "collisionRects": [
              {
                "x": 0.057333,
                "y": 0,
                "w": 1.043467,
                "h": 0.749514
              },
              {
                "x": 0.057333,
                "y": 0.749514,
                "w": 0.2408,
                "h": 0.582955
              },
              {
                "x": 0.871467,
                "y": 0.749514,
                "w": 0.229333,
                "h": 0.582955
              }
            ],
            "depth": 21.407054,
            "occlusionShapes": [
              [[0.24,-0.0],[0.78,-0.0],[0.94,0.15],[0.98,0.4],[0.83,0.54],[0.15,0.54],[0.011628,0.38],[0.04,0.16]],
              [[0.05,0.48],[0.26,0.52],[0.26,0.96],[0.05,0.96]],
              [[0.76,0.5],[0.96,0.46],[0.96,0.95],[0.76,0.96]],
              [[0.24,0.68],[0.78,0.68],[0.78,0.77],[0.24,0.77]]
            ]
          },
          {
            "kind": "fishingStoolEast",
            "room": "hall",
            "baked": true,
            "x": 37.12,
            "y": 20.71306,
            "w": 1.173333,
            "h": 1.414681,
            "collisionRects": [
              {
                "x": 0.058667,
                "y": 0,
                "w": 1.067733,
                "h": 0.763928
              },
              {
                "x": 0.058667,
                "y": 0.763928,
                "w": 0.2464,
                "h": 0.594166
              },
              {
                "x": 0.891733,
                "y": 0.763928,
                "w": 0.234667,
                "h": 0.594166
              }
            ],
            "depth": 22.127741,
            "occlusionShapes": [
              [[0.24,0.0],[0.78,0.0],[0.94,0.15],[0.98,0.4],[0.83,0.54],[0.15,0.54],[0.011364,0.38],[0.04,0.16]],
              [[0.05,0.48],[0.26,0.52],[0.26,0.96],[0.05,0.96]],
              [[0.76,0.5],[0.96,0.46],[0.96,0.95],[0.76,0.96]],
              [[0.24,0.68],[0.78,0.68],[0.78,0.77],[0.24,0.77]]
            ]
          },
          {
            "kind": "fishingRods", "room": "hall", "baked": true,
            "x": 32.64, "y": 16.8, "w": 1.28, "h": 2.88,
            "collision": {"x":32.8533,"y":18.8,"w":1.0133,"h":0.8533},
            "depth": 19.6533,
            "occlusionShapes": [[[0.05,0.05],[0.19,0],[0.44,0.68],[0.32,0.75]],[[0.47,0.12],[0.56,0.12],[0.56,0.69],[0.47,0.69]],[[0.15,0.68],[0.9,0.68],[0.95,0.82],[0.88,1],[0.24,1],[0.13,0.82]]]
          },
          {
            "kind": "stageBalloonsRight",
            "room": "hall",
            "baked": true,
            "x": 28.986667,
            "y": 4.804576,
            "w": 1.813333,
            "h": 3.229743,
            "depth": 8.5949,
            "occlusionShapes": [
              [[0.16176,0.0],[0.41176,0.0],[0.41176,0.01653],[0.47059,0.01653],[0.47059,0.04132],[0.51471,0.04132],[0.51471,0.07438],[0.55882,0.07438],[0.55882,0.13223],[0.52941,0.13223],[0.52941,0.18182],[0.48529,0.22314],[0.42647,0.2562],[0.38235,0.28099],[0.14706,0.28099],[0.11765,0.30579],[0.10294,0.28099],[0.05882,0.2562],[0.04412,0.19835],[0.04412,0.12397],[0.07353,0.08264],[0.13235,0.04959],[0.13235,0.01653]],
              [[0.51471,0.19835],[0.69118,0.19835],[0.76471,0.21488],[0.81618,0.24793],[0.84559,0.29752],[0.84559,0.35537],[0.80882,0.38843],[0.77941,0.40496],[0.57353,0.41322],[0.51471,0.43802],[0.5,0.40496],[0.44118,0.38017],[0.41176,0.34711],[0.39706,0.28926],[0.42647,0.23967]],
              [[0.14706,0.28926],[0.35294,0.28926],[0.45588,0.32231],[0.52941,0.35537],[0.57353,0.39669],[0.57353,0.47934],[0.52941,0.52893],[0.47059,0.58678],[0.36765,0.6281],[0.20588,0.63636],[0.11765,0.60331],[0.05882,0.57025],[0.01471,0.5124],[0.0,0.43802],[0.01471,0.38017],[0.05882,0.33884],[0.11765,0.32231]],
              [[0.61765,0.39669],[0.80882,0.39669],[0.88235,0.42149],[0.92647,0.45455],[0.97059,0.50413],[0.98529,0.56198],[0.97059,0.61157],[0.94118,0.65289],[0.86765,0.69421],[0.77941,0.72727],[0.67647,0.7438],[0.57353,0.73554],[0.51471,0.70248],[0.48529,0.64463],[0.48529,0.55372],[0.51471,0.4876],[0.57353,0.43802]],
              [[0.25,0.55372],[0.45588,0.55372],[0.51471,0.58678],[0.57353,0.61983],[0.63235,0.6281],[0.66176,0.66942],[0.64706,0.71074],[0.58824,0.7438],[0.52941,0.78512],[0.51471,0.81818],[0.30882,0.81818],[0.27941,0.78512],[0.22059,0.75207],[0.17647,0.71901],[0.16176,0.66942],[0.19118,0.63636],[0.19118,0.58678]],
              [[0.375,0.81818],[0.40441,0.81818],[0.40074,0.95248],[0.42647,0.9876],[0.39706,0.99587],[0.36765,0.96488]],
              [[0.56618,0.80992],[0.59559,0.80992],[0.52941,0.91736],[0.44853,0.99587],[0.42647,0.9876],[0.5,0.90909]]
            ]
          },
          {
            "kind": "stageBalloonBaseRight",
            "room": "hall",
            "baked": true,
            "x": 29.306667,
            "y": 8.007626,
            "w": 0.933333,
            "h": 2.055291,
            "depth": 8.5949,
            "occlusionShapes": [
              [[0.4,0.012987],[0.514286,0.0],[0.657143,0.051948],[0.628571,0.103896],[0.485714,0.142857],[0.371428,0.090909]],
              [[0.057143,0.090909],[0.2,0.064935],[0.371428,0.103896],[0.514286,0.142857],[0.428571,0.25974],[0.228571,0.311688],[0.057143,0.25974]],
              [[0.571428,0.116883],[0.742857,0.077922],[0.885714,0.090909],[0.942857,0.168831],[0.885714,0.25974],[0.742857,0.311688],[0.571428,0.246753]],
              [[0.4,0.285714],[0.571428,0.285714],[0.628571,0.454546],[0.714286,0.636364],[0.714286,0.896104],[0.571428,0.896104],[0.514286,0.974026],[0.428571,0.974026],[0.342857,0.896104],[0.171428,0.896104],[0.2,0.649351],[0.285714,0.506494]],
              [[0.142857,0.298701],[0.257143,0.324675],[0.171428,0.428572],[0.028571,0.454546],[-0.0,0.415585]],
              [[0.685714,0.324675],[0.8,0.298701],[0.914286,0.402598],[0.942857,0.441559],[0.771428,0.441559]]
            ],
            "collisionRects": [
              {
                "x": 0.293333,
                "y": 0.427074,
                "w": 0.32,
                "h": 0.1602
              }
            ]
          },
          {
            "kind": "entryWhaleBalloons",
            "room": "hall",
            "baked": true,
            "x": 13.0133,
            "y": 22.0477,
            "w": 3.2267,
            "h": 4.8046,
            "depth": 26.4519,
            "occlusionShapes": [
              [[0.0248,0.1611],[0.0413,0.1222],[0.157,0.1111],[0.2479,0.1555],[0.2645,0.0389],[0.3471,0.0055],[0.4463,0.0167],[0.4876,0.0833],[0.4215,0.1778],[0.5455,0.1555],[0.7934,0.1555],[0.9008,0.2],[0.9256,0.3389],[0.8843,0.4167],[0.7521,0.4667],[0.4793,0.4722],[0.3388,0.4222],[0.2727,0.3389],[0.2645,0.2333],[0.1322,0.2444]],
              [[0.0413,0.35],[0.1984,0.3444],[0.3141,0.4],[0.3141,0.5055],[0.2562,0.5889],[0.1488,0.6],[0.0248,0.5611],[0,0.4611]],
              [[0.2479,0.5111],[0.4132,0.5055],[0.4793,0.5611],[0.4876,0.6611],[0.4215,0.7333],[0.3058,0.7333],[0.2231,0.6778],[0.2149,0.5778]],
              [[0.5041,0.5167],[0.6777,0.5055],[0.7521,0.5611],[0.7603,0.65],[0.6777,0.7111],[0.5372,0.7],[0.4793,0.6278]],
              [[0.281,0.6944],[0.2975,0.6944],[0.4298,0.8555],[0.4132,0.8555]],
              [[0.6529,0.6889],[0.6777,0.6889],[0.4463,0.8611],[0.4298,0.8611]],
              [[0.3306,0.85],[0.4298,0.8778],[0.5124,0.8444],[0.5372,0.9],[0.4628,0.9278],[0.5041,0.9889],[0.4463,1],[0.405,0.9278],[0.3636,1],[0.3058,0.9833],[0.3554,0.9111],[0.2893,0.8944]]
            ]
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
              "alternateFeet": true,
              "footBounds": [[17, 24], [16, 25]]
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
              "alternateFeet": true,
              "footBounds": [[16, 24], [17, 24]]
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
              "alternateFeet": true,
              "footBounds": [[15, 24], [18, 24]]
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
              "alternateFeet": true,
              "footBounds": [[17, 22], [17, 22]]
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
              "alternateFeet": true,
              "footBounds": [[16, 23], [16, 24]]
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
          "performances": {
            "drums": {
              "art": "haewonDrums",
              "height": 40,
              "detailScale": 1.5,
              "maxWidth": 34,
              "fps": 6,
              "restFrame": 1,
              "frames": [[
                [412, 213, 328, 601, 164],
                [28, 213, 328, 601, 164],
                [796, 213, 328, 601, 164],
                [28, 213, 328, 601, 164]
              ]]
            },
            "guitar": {
              "art": "kyujinGuitar",
              "motionRegion": [12, 21, 9, 9],
              "height": 40,
              "detailScale": 1.5,
              "maxWidth": 34,
              "fps": 6,
              "restFrame": 0,
              "frames": [[
                [100, 60, 460, 566, 214],
                [727, 60, 460, 566, 214],
                [100, 687, 460, 566, 214],
                [727, 687, 460, 566, 214]
              ]]
            }
          },
          "playerMotion": "parent",
          "preciseCollision": true,
          "footprint": {
            "x": 4,
            "y": 9,
            "w": 8,
            "h": 5
          },
          "colliders": [
            { "x": 30.8, "y": 6.4, "w": 0.6, "h": 3.92 },
            { "x": 31.4, "y": 6.4, "w": 1.6, "h": 0.5 },
            { "x": 34, "y": 6.4, "w": 1.78, "h": 0.5 },
            { "x": 35.28, "y": 5.6, "w": 0.5, "h": 0.8 },
            { "x": 0.64, "y": 14.88, "w": 0.6667, "h": 8.7733 },
            { "x": 38.4, "y": 14.88, "w": 0.6, "h": 8.7733 },
            {
              "x": 9.3333,
              "y": 3.7867,
              "w": 21.12,
              "h": 1.52
            },
            {
              "x": 35.28,
              "y": 3.84,
              "w": 3.4667,
              "h": 1.76
            },
            {
              "x": 1.0667,
              "y": 23.6533,
              "w": 17.12,
              "h": 1.0667
            },
            {
              "x": 21.6267,
              "y": 23.6533,
              "w": 17.28,
              "h": 1.0667
            }
          ],
          "recordVisual": {
            "x": 6.85,
            "y": 5.91,
            "size": 0.8
          }
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
          { s: 'haewon', t: '杂物间没有门，直接从南侧开口进去，里面有第二颗星。先和六位 Muse 都聊聊，再找齐两颗星——然后去舞台上看看唱片机。' },
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
          { s: 'haewon', t: '我是今天的鼓手。唱片放在左上杂物间的矮柜上，从南侧开口直接进去就能看见。先和大家聊聊、找齐两颗星，再拿回来播放吧。' },
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
          { s: 'bae', t: '先来玩套圈吧！到左侧摊位前按 E / A，依次套中鲸鱼、月亮和星星，就能拿到第一颗星。没套中也可以重试。第二颗星在左上杂物间，从南侧开口直接进去。' },
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
          { s: 'kyujin', t: '吉他已经调好音了。还缺杂物间里的唱片——拿回来放到右边唱片机，音乐响起后走到右侧蓝幕布入口前，向上走就到后台了。进去后就沿星光门继续旅程，不能回礼堂。' },
        ],
      },
      'l1.lily.hint': {
        type: 'hint', trigger: 'npc:lily', once: false,
        lines: [
          { s: 'lily', t: '欢迎来到生日会！先和六位 Muse 聊聊；左边套圈摊位藏着第一颗星，左上杂物间里有第二颗。杂物间从南侧开口直接进入，唱片线索问舞台上的鼓手和吉他手。' },
          { s: 'lily', t: '小时候的生日会，本来就是要慢慢过的呀。' },
        ],
      },
      'l1.haewon.hint': {
        type: 'hint', trigger: 'npc:haewon', once: false,
        lines: [{s:'haewon',t:'唱片在左上杂物间的矮柜上，从南侧开口直接进去。六段自我介绍和套圈、杂物间的两颗星齐备后，再把唱片带回来播放。'}],
      },
      'l1.kyujin.hint': {
        type:'hint', trigger:'npc:kyujin', once:false,
        lines:[{s:'kyujin',t:'唱片拿回来了吗？放进右边唱片机，等音乐响起再到右侧蓝幕布入口前，向上走进去。后台不能回礼堂，想玩的先玩好。'}],
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
            "t": "温柔的旋律响起。走到右侧蓝色幕布的入口前，再向上走进去，就到后台化妆间了。"
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
          { s: 'byeori', t: '目标达成！后台左侧的星光门通往下一关——Jiwoo 在等的「灯油与火焰」。信使要下冥界啦。' },
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
