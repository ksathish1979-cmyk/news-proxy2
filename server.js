async function resolveGoogleNewsUrl(googleUrl) {

  if (!googleUrl.includes('news.google.com/rss/articles/')) {
    return googleUrl;
  }

  console.log('Google News URL:', googleUrl);

  try {

    const pageResponse = await axios.get(googleUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 20000,
      maxRedirects: 5
    });

    const html = pageResponse.data;

    /*
     * Google News article ID
     */

    const urlParts = googleUrl.split('/rss/articles/');

    if (!urlParts[1]) {
      throw new Error('Google News Article ID దొరకలేదు.');
    }

    const articleId = urlParts[1].split('?')[0];

    /*
     * Signature
     */

    const signatureMatch =
      html.match(/data-n-a-sg="([^"]+)"/) ||
      html.match(/data-n-a-sg='([^']+)'/);

    /*
     * Timestamp
     */

    const timestampMatch =
      html.match(/data-n-a-ts="([^"]+)"/) ||
      html.match(/data-n-a-ts='([^']+)'/);

    const signature =
      signatureMatch ? signatureMatch[1] : null;

    const timestamp =
      timestampMatch ? timestampMatch[1] : null;

    console.log('Google Article ID:', articleId);
    console.log('Signature found:', !!signature);
    console.log('Timestamp found:', !!timestamp);

    if (!signature || !timestamp) {
      throw new Error(
        'Google News signature లేదా timestamp దొరకలేదు.'
      );
    }

    /*
     * IMPORTANT:
     * ID + timestamp + signature
     * మూడు Google batchexecute requestలో పంపాలి.
     */

    const articleRequest = [
      'garturlreq',
      [
        [
          'X',
          'X',
          ['X', 'X'],
          null,
          null,
          1,
          1,
          'US:en',
          null,
          1,
          null,
          null,
          null,
          null,
          null,
          0,
          1
        ],
        'X',
        'X',
        1,
        [1, 1, 1],
        1,
        1,
        null,
        0,
        0,
        null,
        0,
        0,
        null
      ],
      articleId,
      Number(timestamp),
      signature
    ];

    const rpcRequest = [
      [
        'Fbv4je',
        JSON.stringify(articleRequest),
        null,
        'generic'
      ]
    ];

    const formData =
      new URLSearchParams({
        'f.req': JSON.stringify([rpcRequest])
      }).toString();

    console.log('Sending Google batchexecute request...');

    const rpcResponse = await axios.post(
      'https://news.google.com/_/DotsSplashUi/data/batchexecute',
      formData,
      {
        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
          'Referer':
            'https://news.google.com/',
          'Origin':
            'https://news.google.com'
        },
        timeout: 20000
      }
    );

    const responseText = rpcResponse.data;

    console.log(
      'Google resolution response received:',
      responseText.length
    );

    /*
     * Google response:
     *
     * ["garturlres","REAL_URL",...]
     */

    const marker =
      '[\\"garturlres\\",\\"';

    const markerIndex =
      responseText.indexOf(marker);

    if (markerIndex === -1) {

      console.log(
        'Google response:',
        responseText.substring(0, 1000)
      );

      throw new Error(
        'Google News responseలో garturlres దొరకలేదు.'
      );
    }

    const start =
      markerIndex + marker.length;

    const remaining =
      responseText.substring(start);

    const end =
      remaining.indexOf('\\",');

    if (end === -1) {
      throw new Error(
        'Publisher URL ముగింపు గుర్తించలేకపోయాం.'
      );
    }

    let publisherUrl =
      remaining.substring(0, end);

    /*
     * Google escaped characters
     */

    publisherUrl = publisherUrl
      .replace(/\\u003d/g, '=')
      .replace(/\\u0026/g, '&')
      .replace(/\\\//g, '/')
      .replace(/\\"/g, '"');

    console.log(
      'Publisher URL found:',
      publisherUrl
    );

    if (
      !publisherUrl.startsWith('http://') &&
      !publisherUrl.startsWith('https://')
    ) {
      throw new Error(
        'దొరికిన Publisher URL చెల్లుబాటు అయ్యేది కాదు.'
      );
    }

    return publisherUrl;

  } catch (err) {

    console.error(
      'Google News Resolver Error:',
      err.message
    );

    throw err;
  }
}
