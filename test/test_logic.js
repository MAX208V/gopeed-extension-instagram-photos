// ============================================================
// 单元测试 — gopeed-extension-instagram-photos
// 验证修改后的 findMedia 优先级 + 文件命名逻辑
// ============================================================

// ---- 复制待测函数定义（与 src/index.js 保持一致） ----
function extractShortcode(url) {
  var path = url.split('?')[0];
  var m = path.match(/instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

function pickBest(images) {
  if (!images || images.length === 0) return null;
  var best = images[0];
  for (var i = 1; i < images.length; i++) {
    if ((images[i].width || 0) * (images[i].height || 0) > (best.width || 0) * (best.height || 0)) {
      best = images[i];
    }
  }
  return best;
}

function findMedia(obj, result, inheritedUser) {
  if (!obj || typeof obj !== 'object') return;
  var user = inheritedUser || '';
  if (obj.user && obj.user.username) user = obj.user.username;

  var caption = '';
  if (obj.caption && obj.caption.text) caption = obj.caption.text;

  var carousel = null;
  if (obj.carousel_media && Array.isArray(obj.carousel_media)) {
    carousel = obj.carousel_media;
  } else if (obj.edge_sidecar_to_children && Array.isArray(obj.edge_sidecar_to_children.edges)) {
    carousel = [];
    for (var i = 0; i < obj.edge_sidecar_to_children.edges.length; i++) {
      var e = obj.edge_sidecar_to_children.edges[i];
      if (e && e.node) carousel.push(e.node);
    }
  }
  if (carousel) {
    for (var i = 0; i < carousel.length; i++) {
      var cm = carousel[i];
      var entry = { username: user, title: caption, images: [], videos: [] };
      if (cm.video_versions && Array.isArray(cm.video_versions)) {
        entry.videos = mapVersions(cm.video_versions);
      }
      if (cm.image_versions2 && cm.image_versions2.candidates) {
        entry.images = mapCandidates(cm.image_versions2.candidates);
      }
      if (entry.images.length === 0 && entry.videos.length === 0) {
        if (cm.display_resources && Array.isArray(cm.display_resources)) {
          entry.images = cm.display_resources.map(function(r) {
            return { url: r.src || r.url, width: r.config_width || 0, height: r.config_height || 0 };
          });
        } else if (cm.display_url) {
          entry.images = [{ url: cm.display_url, width: 0, height: 0 }];
        }
      }
      if (entry.images.length > 0 || entry.videos.length > 0) {
        result.push(entry);
      }
    }
    return;
  }

  if (obj.video_versions && Array.isArray(obj.video_versions)) {
    var entry = { username: user, title: caption, images: [], videos: mapVersions(obj.video_versions) };
    if (obj.image_versions2 && obj.image_versions2.candidates) {
      entry.images = mapCandidates(obj.image_versions2.candidates);
    }
    if (!entry.title) entry.title = caption;
    result.push(entry);
    return;
  }

  if (obj.image_versions2 && obj.image_versions2.candidates && obj.image_versions2.candidates.length > 0) {
    result.push({ username: user, title: caption, images: mapCandidates(obj.image_versions2.candidates), videos: [] });
    return;
  }

  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) findMedia(obj[i], result, user);
  } else {
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (key === '__typename' || key === 'config' || key === 'display_url') continue;
      var val = obj[key];
      if (Array.isArray(val) && val.length > 200) continue;
      findMedia(val, result, user);
    }
  }
}

function mapCandidates(candidates) {
  var result = [];
  for (var i = 0; i < candidates.length; i++) {
    result.push({ url: candidates[i].url, width: candidates[i].width || 0, height: candidates[i].height || 0 });
  }
  return result;
}

function sanitizeTitle(text) {
  if (!text) return '';
  var t = text.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (t.length > 18) t = t.substring(0, 18).replace(/_+$/, '');
  return t;
}

function mapVersions(versions) {
  var result = [];
  for (var i = 0; i < versions.length; i++) {
    result.push({ url: versions[i].url, width: versions[i].width || 0, height: versions[i].height || 0 });
  }
  return result;
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

// ---- 模拟 onResolve 核心逻辑 ----
function simulateOnResolve(url, parsedData) {
  var shortcode = extractShortcode(url);
  if (!shortcode) return { error: 'Invalid URL' };

  var items = [];
  findMedia(parsedData, items);
  if (items.length === 0) return { error: 'No media found' };

  var primaryUser = 'instagram';
  for (var i = 0; i < items.length; i++) {
    if (items[i].username) { primaryUser = items[i].username; break; }
  }

  var files = [];
  var imgIdx = 0, vidIdx = 0;
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var username = item.username || primaryUser;
    var titlePart = item.title ? '_' + sanitizeTitle(item.title) : '';
    if (item.images && item.images.length > 0) {
      var best = pickBest(item.images);
      if (best && best.url) {
        imgIdx++;
        var suffix = '_' + pad2(imgIdx);
        files.push({ name: username + '_' + shortcode + titlePart + suffix + '.jpg', req: { url: best.url } });
      }
    }
    if (item.videos && item.videos.length > 0) {
      var best = pickBest(item.videos);
      if (best && best.url) {
        vidIdx++;
        var suffix = '_' + pad2(vidIdx);
        files.push({ name: username + '_' + shortcode + titlePart + suffix + '.mp4', req: { url: best.url } });
      }
    }
  }
  if (files.length === 1) {
    files[0].name = files[0].name.replace(/_\d{2}(\.\w+)$/, '$1');
  }
  if (files.length === 0) return { error: 'No downloadable media' };
  return { name: 'instagram_' + shortcode, files: files };
}

// ============================================================
// 测试用例
// ============================================================
var results = [];

function test(name, url, data, expectFiles, expectNameContains) {
  var pass = true, actual = null, reason = '';
  try {
    actual = simulateOnResolve(url, data);
    if (actual.error) { pass = false; reason = actual.error; }
    else {
      if (actual.files.length !== expectFiles) { pass = false; reason = 'file count: expect ' + expectFiles + ', got ' + actual.files.length; }
      if (pass && expectNameContains) {
        for (var i = 0; i < expectNameContains.length; i++) {
          if (actual.files[i].name.indexOf(expectNameContains[i]) === -1) {
            pass = false;
            reason = 'file[' + i + ']: expect contains "' + expectNameContains[i] + '", got "' + actual.files[i].name + '"';
            break;
          }
        }
      }
    }
  } catch(e) { pass = false; reason = e.message; }
  results.push({ name: name, pass: pass, reason: reason, actual: actual });
}

// 用例 1：Carousel 纯图片（image_versions2 + carousel_media 同级 —— mcdonaldsjapan 重构核心场景）
test(
  'Carousel 纯图片 (img_ver + carousel_media 同级)',
  'https://www.instagram.com/mcdonaldsjapan/p/DaaYXRrH9Em/?img_index=3',
  {
    shortcode_media: {
      shortcode: 'DaaYXRrH9Em',
      user: { username: 'mcdonaldsjapan' },
      caption: { text: 'マックの新メニュー登場' },
      image_versions2: { candidates: [
        { url: 'https://cdn.fbcdn.net/cover_thumbnail.jpg', width: 320, height: 320 }
      ]},
      carousel_media: [
        { image_versions2: { candidates: [
          { url: 'https://cdn.fbcdn.net/img1_1080.jpg', width: 1080, height: 1350 },
          { url: 'https://cdn.fbcdn.net/img1_640.jpg', width: 640, height: 800 }
        ]}},
        { image_versions2: { candidates: [
          { url: 'https://cdn.fbcdn.net/img2_1080.jpg', width: 1080, height: 1350 }
        ]}},
        { image_versions2: { candidates: [
          { url: 'https://cdn.fbcdn.net/img3_1080.jpg', width: 1080, height: 1350 }
        ]}}
      ]
    }
  },
  3,
  ['_01.jpg', '_02.jpg', '_03.jpg']
);

// 用例 2：单图帖（不带序号 —— 只1个文件，_01 被剥离）
test(
  '单图帖 (应无序号)',
  'https://www.instagram.com/someuser/p/ABC123/',
  {
    shortcode_media: {
      shortcode: 'ABC123',
      user: { username: 'someuser' },
      caption: { text: 'Solo photo' },
      image_versions2: { candidates: [
        { url: 'https://cdn.fbcdn.net/single.jpg', width: 1080, height: 1080 }
      ]}
    }
  },
  1,
  ['Solo_photo.jpg']  // 单文件 _01 被剥离
);

// 用例 3：Carousel 图+视频混排 (iamjohngazellekung 帖)
test(
  'Carousel 图+视频混排',
  'https://www.instagram.com/iamjohngazellekung/p/DZ5OA5ljPEd/?img_index=1',
  {
    shortcode_media: {
      shortcode: 'DZ5OA5ljPEd',
      user: { username: 'iamjohngazellekung' },
      caption: { text: 'Mixed content' },
      image_versions2: { candidates: [
        { url: 'https://cdn.fbcdn.net/cover.jpg', width: 640, height: 640 }
      ]},
      carousel_media: [
        { image_versions2: { candidates: [
          { url: 'https://cdn.fbcdn.net/p1.jpg', width: 1080, height: 1350 }
        ]}},
        { video_versions: [
          { url: 'https://cdn.cdninstagram.net/v1.mp4', width: 720, height: 1280 }
        ]},
        { image_versions2: { candidates: [
          { url: 'https://cdn.fbcdn.net/p3.jpg', width: 1080, height: 1350 }
        ]}}
      ]
    }
  },
  3,
  ['_01.jpg', '_01.mp4', '_02.jpg']
);

// 用例 4：单视频 reel（poster图+视频 2个文件，都带 _01 序号）
test(
  '单视频 reel (poster + video 2文件)',
  'https://www.instagram.com/someuser/reel/XYZ789/',
  {
    shortcode_media: {
      shortcode: 'XYZ789',
      user: { username: 'someuser' },
      caption: { text: 'Reel video' },
      video_versions: [
        { url: 'https://cdn.cdninstagram.net/reel.mp4', width: 1080, height: 1920 }
      ],
      image_versions2: { candidates: [
        { url: 'https://cdn.fbcdn.net/poster.jpg', width: 480, height: 854 }
      ]}
    }
  },
  2,
  ['_01.jpg', '_01.mp4']
);

// 用例 5：GraphQL edge_sidecar_to_children carousel
test(
  'GraphQL edge_sidecar_to_children carousel',
  'https://www.instagram.com/user/p/GQL123/',
  {
    shortcode_media: {
      shortcode: 'GQL123',
      user: { username: 'user' },
      caption: { text: 'Graphql carousel' },
      edge_sidecar_to_children: {
        edges: [
          { node: { display_url: 'https://cdn.fbcdn.net/gql1.jpg', display_resources: [
            { src: 'https://cdn.fbcdn.net/gql1_1080.jpg', config_width: 1080, config_height: 1350 }
          ]}},
          { node: { display_url: 'https://cdn.fbcdn.net/gql2.jpg', display_resources: [
            { src: 'https://cdn.fbcdn.net/gql2_1080.jpg', config_width: 1080, config_height: 1350 }
          ]}}
        ]
      }
    }
  },
  2,
  ['_01.jpg', '_02.jpg']
);

// 用例 6：深层嵌套 + RelayPrefetchedStreamCache 多层
test(
  '深层嵌套 carousel',
  'https://www.instagram.com/mcdonaldsjapan/p/DEEP01/',
  {
    relay_payload: {
      data: {
        xdt_shortcode_media: {
          shortcode: 'DEEP01',
          user: { username: 'mcdonaldsjapan' },
          caption: { text: 'Deep carousel' },
          image_versions2: { candidates: [
            { url: 'https://cdn.fbcdn.net/cover.jpg', width: 320, height: 320 }
          ]},
          carousel_media: [
            { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/deep1.jpg', width: 1080, height: 1350 }]}},
            { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/deep2.jpg', width: 1080, height: 1350 }]}},
            { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/deep3.jpg', width: 1080, height: 1350 }]}},
            { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/deep4.jpg', width: 1080, height: 1350 }]}},
            { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/deep5.jpg', width: 1080, height: 1350 }]}},
            { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/deep6.jpg', width: 1080, height: 1350 }]}},
            { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/deep7.jpg', width: 1080, height: 1350 }]}},
            { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/deep8.jpg', width: 1080, height: 1350 }]}},
            { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/deep9.jpg', width: 1080, height: 1350 }]}},
            { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/deep10.jpg', width: 1080, height: 1350 }]}},
            { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/deep11.jpg', width: 1080, height: 1350 }]}}
          ]
        }
      }
    }
  },
  11,
  ['_01.jpg', '_02.jpg', '_03.jpg', '_04.jpg', '_05.jpg', '_06.jpg', '_07.jpg', '_08.jpg', '_09.jpg', '_10.jpg', '_11.jpg']
);

// 用例 7：帖子标题含特殊字符（清洗后保持合理命名）
test(
  '标题特殊字符清洗',
  'https://www.instagram.com/user/p/TITLE01/',
  {
    shortcode_media: {
      shortcode: 'TITLE01',
      user: { username: 'user' },
      caption: { text: '特别的：file/name*with?bad\\chars' },
      carousel_media: [
        { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/a.jpg', width: 1080, height: 1080 }]}},
        { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/b.jpg', width: 1080, height: 1080 }]}}
      ]
    }
  },
  2,
  ['_01.jpg', '_02.jpg']
);

// 用例 8：无 caption + 大型 carousel（验证大规模序号 zero-padding）
test(
  '无 caption 22图 carousel (大序号)',
  'https://www.instagram.com/user/p/NOCAP01/',
  {
    shortcode_media: {
      shortcode: 'NOCAP01',
      user: { username: 'user' },
      carousel_media: [
        { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/a.jpg', width: 1080, height: 1080 }]}},
        { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/b.jpg', width: 1080, height: 1080 }]}},
        { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/c.jpg', width: 1080, height: 1080 }]}},
        { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/d.jpg', width: 1080, height: 1080 }]}},
        { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/e.jpg', width: 1080, height: 1080 }]}},
        { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/f.jpg', width: 1080, height: 1080 }]}},
        { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/g.jpg', width: 1080, height: 1080 }]}},
        { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/h.jpg', width: 1080, height: 1080 }]}},
        { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/i.jpg', width: 1080, height: 1080 }]}},
        { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/j.jpg', width: 1080, height: 1080 }]}},
        { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/k.jpg', width: 1080, height: 1080 }]}},
        { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/l.jpg', width: 1080, height: 1080 }]}},
        { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/m.jpg', width: 1080, height: 1080 }]}},
        { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/n.jpg', width: 1080, height: 1080 }]}},
        { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/o.jpg', width: 1080, height: 1080 }]}},
        { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/p.jpg', width: 1080, height: 1080 }]}},
        { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/q.jpg', width: 1080, height: 1080 }]}},
        { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/r.jpg', width: 1080, height: 1080 }]}},
        { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/s.jpg', width: 1080, height: 1080 }]}},
        { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/t.jpg', width: 1080, height: 1080 }]}},
        { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/u.jpg', width: 1080, height: 1080 }]}},
        { image_versions2: { candidates: [{ url: 'https://cdn.fbcdn.net/v.jpg', width: 1080, height: 1080 }]}}
      ]
    }
  },
  22,
  ['NOCAP01_01.jpg', 'NOCAP01_02.jpg', 'NOCAP01_03.jpg', 'NOCAP01_04.jpg', 'NOCAP01_05.jpg']
);

// ---- 输出结果 ----
var passCount = 0, failCount = 0;
var summary = '\n=== Test Results ===\n';
for (var i = 0; i < results.length; i++) {
  var r = results[i];
  if (r.pass) {
    passCount++;
    summary += '#' + (i+1) + ' PASS  ' + r.name + '\n';
  } else {
    failCount++;
    summary += '#' + (i+1) + ' FAIL  ' + r.name + ' -- ' + r.reason + '\n';
  }
  if (r.actual && r.actual.files) {
    for (var j = 0; j < r.actual.files.length; j++) {
      summary += '     - ' + r.actual.files[j].name + '\n';
    }
  }
}
summary += '\n总计: ' + passCount + ' pass / ' + failCount + ' fail / ' + results.length + ' 用例\n';
console.log(summary);
