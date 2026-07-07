const INSTAGRAM_HEADERS = {
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.8',
  'cache-control': 'no-cache',
  'pragma': 'no-cache',
  'sec-ch-ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Brave";v="146"',
  'sec-ch-ua-full-version-list': '"Chromium";v="146.0.0.0", "Not-A.Brand";v="24.0.0.0", "Brave";v="146.0.0.0"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-model': '"iPhone"',
  'sec-ch-ua-platform': '"iOS"',
  'sec-ch-ua-platform-version': '"18.5"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'sec-gpc': '1',
  'upgrade-insecure-requests': '1',
  'user-agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  'x-ig-app-id': '936619743392459',
  'x-requested-with': 'XMLHttpRequest',
  'x-asbd-id': '129477',
  'referer': 'https://www.instagram.com/',
  'origin': 'https://www.instagram.com',
};

export function buildProxyUrl(settings) {
  const { proxyType, proxyHost, proxyPort, proxyUsername, proxyPassword } = settings;

  if (!proxyType || proxyType === 'none' || !proxyHost || !proxyPort) {
    return null;
  }

  const scheme = proxyType === 'socks5' ? 'socks5' : 'http';
  let proxyUrl = `${scheme}://`;

  if (proxyUsername && proxyPassword) {
    proxyUrl += `${encodeURIComponent(proxyUsername)}:${encodeURIComponent(proxyPassword)}@`;
  }

  proxyUrl += `${proxyHost}:${proxyPort}`;
  return proxyUrl;
}

export function getFetchOptions(settings) {
  const options = {
    headers: { ...INSTAGRAM_HEADERS },
  };

  // Add cookie if provided
  if (settings.cookie) {
    options.headers.cookie = settings.cookie;
  }

  const proxyUrl = buildProxyUrl(settings);
  if (proxyUrl) {
    options.proxy = proxyUrl;
  }

  return options;
}

export async function fetchPostData(url, settings) {
  const fetchOptions = getFetchOptions(settings);
  const response = await fetch(url, fetchOptions);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const html = await response.text();

  // Try multiple script patterns to extract the embedded JSON data
  let scriptContent = null;
  let jsonStr = null;

  // Pattern 1: Find script tags containing media data (image_versions2 or carousel_media)
  // These are typically <script type="application/json" data-content-len="..." data-sjs>
  // with a {"require":[...]} structure containing RelayPrefetchedStreamCache
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let bestMatch = null;
  let bestMatchLen = 0;

  while ((match = scriptRegex.exec(html)) !== null) {
    const content = match[1];
    // Look for the script that contains the actual media data
    // (contains ScheduledServerJS AND has image_versions2 or carousel_media)
    if (content.includes('ScheduledServerJS')) {
      if (content.includes('image_versions2') || content.includes('carousel_media')) {
        // Prefer the one with the most content (likely has the full data)
        if (content.length > bestMatchLen) {
          bestMatch = content;
          bestMatchLen = content.length;
        }
      }
    }
  }

  if (bestMatch) {
    // Navigate through the nested structure to find the actual media data
    // Structure: {"require":[["ScheduledServerJS","handle",null,[{"__bbox":{"require":[["RelayPrefetchedStreamCache","next",[],[...]],...]}},...]]]}
    try {
      const outerData = JSON.parse(bestMatch);
      if (outerData.require && outerData.require[0] && outerData.require[0][3]) {
        const bboxItems = outerData.require[0][3];
        for (const bboxItem of bboxItems) {
          if (bboxItem && bboxItem.__bbox && bboxItem.__bbox.require) {
            for (const req of bboxItem.__bbox.require) {
              if (Array.isArray(req) && req[0] === 'RelayPrefetchedStreamCache' && req[3]) {
                // req[3] contains the actual data with media items
                jsonStr = JSON.stringify(req[3]);
                break;
              }
            }
          }
          if (jsonStr) break;
        }
      }
    } catch (e) {
      // Fallback to old method
      const jsonStart = bestMatch.indexOf('{');
      const jsonEnd = bestMatch.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        jsonStr = bestMatch.substring(jsonStart, jsonEnd + 1);
      }
    }
  }

  // Pattern 2: Fallback - look for image_versions2 directly in any script tag
  if (!jsonStr) {
    scriptRegex.lastIndex = 0;
    while ((match = scriptRegex.exec(html)) !== null) {
      const content = match[1];
      if (content.includes('image_versions2') || content.includes('carousel_media')) {
        if (content.length > (bestMatchLen || 0)) {
          bestMatch = content;
          bestMatchLen = content.length;
        }
      }
    }
    if (bestMatch) {
      const jsonStart = bestMatch.indexOf('{');
      const jsonEnd = bestMatch.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        jsonStr = bestMatch.substring(jsonStart, jsonEnd + 1);
      }
    }
  }

  // Pattern 3: Fallback to __NEXT_DATA__
  if (!jsonStr) {
    scriptRegex.lastIndex = 0;
    while ((match = scriptRegex.exec(html)) !== null) {
      const content = match[1];
      if (content.includes('__NEXT_DATA__')) {
        const jsonStart = content.indexOf('{');
        const jsonEnd = content.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
          jsonStr = content.substring(jsonStart, jsonEnd + 1);
          break;
        }
      }
    }
  }

  // Pattern 4: Fallback to window.__INITIAL_STATE__
  if (!jsonStr) {
    scriptRegex.lastIndex = 0;
    while ((match = scriptRegex.exec(html)) !== null) {
      const content = match[1];
      if (content.includes('window.__INITIAL_STATE__')) {
        const jsonStart = content.indexOf('{');
        const jsonEnd = content.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
          jsonStr = content.substring(jsonStart, jsonEnd + 1);
          break;
        }
      }
    }
  }

  if (!jsonStr) {
    throw new Error(
      'Could not find embedded JSON data. The page structure may have changed or login is required.'
    );
  }

  const data = JSON.parse(jsonStr);

  const mediaItems = [];

  // Collect usernames found at higher levels as fallback
  let fallbackUsername = '';

  const searchForMedia = (obj, inheritedUser) => {
    if (!obj || typeof obj !== 'object') return;

    // Track user info from higher-level objects
    const objUser = obj.user?.username || inheritedUser || fallbackUsername;
    if (obj.user?.username) {
      fallbackUsername = obj.user.username;
    }

    // Check for single video (reel)
    if (obj.video_versions && Array.isArray(obj.video_versions)) {
      const item = {
        id: obj.pk || obj.id || '',
        code: obj.code || '',
        username: objUser,
        videos: obj.video_versions.map((v) => ({
          url: v.url,
          width: v.width || 0,
          height: v.height || 0,
        })),
        images: [],
        mediaType: 'video',
      };
      if (obj.image_versions2?.candidates) {
        item.images = obj.image_versions2.candidates.map((c) => ({
          url: c.url,
          width: c.width || c.w || 0,
          height: c.height || c.h || 0,
        }));
      }
      mediaItems.push(item);
      return;
    }

    // Check for single image (photo) - only if no carousel_media
    if (obj.image_versions2?.candidates && !obj.video_versions && !obj.carousel_media) {
      mediaItems.push({
        id: obj.pk || obj.id || '',
        code: obj.code || '',
        username: objUser,
        videos: [],
        images: obj.image_versions2.candidates.map((c) => ({
          url: c.url,
          width: c.width || c.w || 0,
          height: c.height || c.h || 0,
        })),
        mediaType: 'image',
      });
      return;
    }

    // Handle carousel_media (multi-image/video posts)
    if (obj.carousel_media && Array.isArray(obj.carousel_media)) {
      for (const item of obj.carousel_media) {
        // Inherit username from parent if carousel item doesn't have its own
        const carouselUser = item.user?.username || objUser;
        searchForMedia(item, carouselUser);
      }
      return;
    }

    // Recursively search arrays
    if (Array.isArray(obj)) {
      for (const item of obj) {
        searchForMedia(item, objUser);
      }
      return;
    }

    // Recursively search object keys
    for (const key of Object.keys(obj)) {
      // Skip common large non-relevant fields for performance
      if (key === '__typename' || key === 'config' || key === 'display_url') continue;
      searchForMedia(obj[key], objUser);
    }
  };

  searchForMedia(data);

  if (mediaItems.length === 0) {
    throw new Error('No media found in response');
  }

  return mediaItems;
}

export function extractShortcode(url) {
  // Strip query parameters first
  const cleanUrl = url.split('?')[0];
  const patterns = [
    // Match: instagram.com/p/CODE, instagram.com/reel/CODE, etc.
    /instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i,
    // Match: instagram.com/username/p/CODE (with profile name prefix)
    /instagram\.com\/[A-Za-z0-9_.]+\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i,
    // Match shortened: instagr.am/p/CODE
    /instagr\.am\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i,
    // Match: instagram.com/p/CODE?params
    /instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = cleanUrl.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

export function getBestImage(images) {
  if (!images || images.length === 0) return null;
  // Instagram now returns candidates without width/height in some cases
  // Sort by resolution (width * height) descending, pick the highest
  // If all have 0 dimensions, pick the first one (usually highest quality)
  const sorted = images.reduce((best, current) => {
    const bestPixels = (best.width || 0) * (best.height || 0);
    const currentPixels = (current.width || 0) * (current.height || 0);
    return currentPixels > bestPixels ? current : best;
  });
  return sorted;
}

export function getBestVideo(videos) {
  if (!videos || videos.length === 0) return null;
  return videos.reduce((best, current) => {
    const bestPixels = (best.width || 0) * (best.height || 0);
    const currentPixels = (current.width || 0) * (current.height || 0);
    return currentPixels > bestPixels ? current : best;
  });
}
