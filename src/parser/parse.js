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

  // Pattern 1: Look for ScheduledServerJS with RelayPrefetchedStreamCache
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const content = match[1];
    if (content.includes('ScheduledServerJS') && content.includes('RelayPrefetchedStreamCache')) {
      scriptContent = content;
      break;
    }
  }

  if (scriptContent) {
    const jsonStart = scriptContent.indexOf('{');
    const jsonEnd = scriptContent.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      jsonStr = scriptContent.substring(jsonStart, jsonEnd + 1);
    }
  }

  // Pattern 2: Fallback - try to find xdt_shortcode_media in __NEXT_DATA__
  if (!jsonStr) {
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

  // Pattern 3: Fallback to window.__INITIAL_STATE__
  if (!jsonStr) {
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

  const searchForMedia = (obj) => {
    if (!obj || typeof obj !== 'object') return;

    // Check for single video (reel)
    if (obj.video_versions && Array.isArray(obj.video_versions)) {
      const item = {
        id: obj.pk || obj.id || '',
        code: obj.code || '',
        username: obj.user?.username || '',
        videos: obj.video_versions.map((v) => ({
          url: v.url,
          width: v.width,
          height: v.height,
          type: v.type,
        })),
        images: [],
        caption: obj.caption?.text || '',
        mediaType: 'video',
      };

      if (obj.image_versions2?.candidates) {
        item.images = obj.image_versions2.candidates.map((c) => ({
          url: c.url,
          width: c.width,
          height: c.height,
        }));
      }

      mediaItems.push(item);
      return;
    }

    // Check for single image (photo)
    if (obj.image_versions2?.candidates && !obj.video_versions && !obj.carousel_media) {
      mediaItems.push({
        id: obj.pk || obj.id || '',
        code: obj.code || '',
        username: obj.user?.username || '',
        videos: [],
        images: obj.image_versions2.candidates.map((c) => ({
          url: c.url,
          width: c.width,
          height: c.height,
        })),
        caption: obj.caption?.text || '',
        mediaType: 'image',
      });
      return;
    }

    // Handle carousel_media (multi-image/video posts)
    // Attach parent user info to carousel items if they lack it
    if (obj.carousel_media && Array.isArray(obj.carousel_media)) {
      const parentUser = obj.user;
      for (const item of obj.carousel_media) {
        // Inherit parent user if carousel item doesn't have its own
        if (!item.user && parentUser) {
          item.user = parentUser;
        }
        searchForMedia(item);
      }
      return;
    }

    // Recursively search arrays
    if (Array.isArray(obj)) {
      for (const item of obj) {
        searchForMedia(item);
      }
      return;
    }

    // Recursively search object keys
    for (const key of Object.keys(obj)) {
      // Skip common large non-relevant fields for performance
      if (key === '__typename' || key === 'config' || key === 'display_url') continue;
      searchForMedia(obj[key]);
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
    /instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/,
    /instagr\.am\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/,
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
  // Sort by resolution (width * height) descending, pick the highest
  return images.reduce((best, current) => {
    const bestPixels = (best.width || 0) * (best.height || 0);
    const currentPixels = (current.width || 0) * (current.height || 0);
    return currentPixels > bestPixels ? current : best;
  });
}

export function getBestVideo(videos) {
  if (!videos || videos.length === 0) return null;
  return videos.reduce((best, current) => {
    const bestPixels = (best.width || 0) * (best.height || 0);
    const currentPixels = (current.width || 0) * (current.height || 0);
    return currentPixels > bestPixels ? current : best;
  });
}
