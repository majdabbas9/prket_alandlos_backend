// src/cloudManager/R2.js: the parts the data-safety rules rest on. isNotFound decides whether a
// failed read may be treated as "missing" (anything else must surface as a 500), and
// putObjectIfAbsent must never overwrite. The S3 client is stubbed, so nothing hits the network.
const { S3Client } = require('@aws-sdk/client-s3');
const R2 = require('../src/cloudManager/R2');

const s3Error = (name, status) =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });

describe('R2 wrapper', () => {
  let send;

  beforeEach(() => {
    send = jest.spyOn(S3Client.prototype, 'send');
  });

  afterEach(() => {
    send.mockRestore();
  });

  describe('isNotFound', () => {
    it.each([
      ['NoSuchKey', s3Error('NoSuchKey', 404)],
      ['NotFound (HEAD)', s3Error('NotFound', 404)],
      ['any 404', s3Error('Unknown', 404)],
    ])('treats %s as missing', (_label, err) => {
      expect(R2.isNotFound(err)).toBe(true);
    });

    it.each([
      ['a 503', s3Error('InternalError', 503)],
      ['access denied', s3Error('AccessDenied', 403)],
      ['a network error', new TypeError('fetch failed')],
      ['undefined', undefined],
    ])('does not treat %s as missing', (_label, err) => {
      expect(R2.isNotFound(err)).toBe(false);
    });
  });

  describe('putObjectIfAbsent', () => {
    it('sends a conditional PUT and returns true when created', async () => {
      send.mockResolvedValueOnce({});
      await expect(
        R2.putObjectIfAbsent('info/info.json', Buffer.from('{}'), 'application/json', 'b'),
      ).resolves.toBe(true);
      expect(send.mock.calls[0][0].input).toMatchObject({
        Bucket: 'b',
        Key: 'info/info.json',
        ContentType: 'application/json',
        IfNoneMatch: '*',
      });
    });

    it('returns false when the object already exists (412)', async () => {
      send.mockRejectedValueOnce(s3Error('PreconditionFailed', 412));
      await expect(R2.putObjectIfAbsent('k', Buffer.from('x'), 'text/plain')).resolves.toBe(false);
    });

    it('rethrows any other error', async () => {
      send.mockRejectedValueOnce(s3Error('InternalError', 503));
      await expect(R2.putObjectIfAbsent('k', Buffer.from('x'), 'text/plain')).rejects.toThrow(
        'InternalError',
      );
    });
  });

  it('putObject passes Cache-Control only when given', async () => {
    send.mockResolvedValue({ ETag: '"e"' });
    await R2.putObject('a', Buffer.from('x'), 'image/webp', 'b', 'public, max-age=1');
    await R2.putObject('a', Buffer.from('x'), 'image/webp', 'b');
    expect(send.mock.calls[0][0].input.CacheControl).toBe('public, max-age=1');
    expect(send.mock.calls[1][0].input).not.toHaveProperty('CacheControl');
  });

  it('getObject and headObject propagate errors to the caller', async () => {
    send.mockRejectedValue(s3Error('NoSuchKey', 404));
    await expect(R2.getObject('missing')).rejects.toMatchObject({ name: 'NoSuchKey' });
    await expect(R2.headObject('missing')).rejects.toMatchObject({ name: 'NoSuchKey' });
  });
});
