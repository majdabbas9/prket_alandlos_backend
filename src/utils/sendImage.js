const { pipeline } = require('stream');
const logger = require('./logger').getLogger(__filename);

// Browsers/CDNs may reuse the image for this long, then revalidate with the ETag
const CACHE_CONTROL = 'public, max-age=300';

/**
 * Streams an image to the client with caching headers, answering 304 when the
 * client's cached copy (If-None-Match / If-Modified-Since) is still current.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{body: import('stream').Readable, contentType: string, contentLength?: number, etag?: string, lastModified?: Date}} image
 */
function sendImage(req, res, image) {
  res.setHeader('Content-Type', image.contentType);
  res.setHeader('Cache-Control', CACHE_CONTROL);
  if (image.etag) res.setHeader('ETag', image.etag);
  if (image.lastModified) res.setHeader('Last-Modified', image.lastModified.toUTCString());

  if (req.fresh) {
    image.body.destroy();
    return res.status(304).end();
  }

  if (image.contentLength) res.setHeader('Content-Length', image.contentLength);
  res.status(200);
  pipeline(image.body, res, (err) => {
    // Premature close just means the client disconnected mid-download
    if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE')
      logger.error({ err, path: req.originalUrl }, 'Error streaming image to client');
  });
}

module.exports = sendImage;
