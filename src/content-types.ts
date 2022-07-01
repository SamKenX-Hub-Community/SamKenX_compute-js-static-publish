type TestFn = (name: string) => boolean;

type ContentTypeDef = {
  test: RegExp | TestFn,
  type: string,
  binary?: boolean,
};

export const CONTENT_TYPES: ContentTypeDef[] = [
  // Text formats
  { test: /.txt$/, type: 'text/plain', binary: false },
  { test: /.htm(l)?$/, type: 'text/html', binary: false },
  { test: /.xml$/, type: 'application/xml', binary: false },
  { test: /.json$/, type: 'application/json', binary: false },
  { test: /.map$/, type: 'application/json', binary: false },
  { test: /.js$/, type: 'application/javascript', binary: false },
  { test: /.css$/, type: 'text/css', binary: false },
  { test: /.svg$/, type: 'image/svg+xml', binary: false },

  // Binary formats
  { test: /.bmp$/, type: 'image/bmp', binary: true },
  { test: /.png$/, type: 'image/png', binary: true },
  { test: /.gif$/, type: 'image/gif', binary: true },
  { test: /.jp(e)?g$/, type: 'image/jpeg', binary: true },
  { test: /.ico$/, type: 'image/vnd.microsoft.icon', binary: true },
  { test: /.tif(f)?$/, type: 'image/png', binary: true },
  { test: /.aac$/, type: 'audio/aac', binary: true },
  { test: /.mp3$/, type: 'audio/mpeg', binary: true },
  { test: /.avi$/, type: 'video/x-msvideo', binary: true },
  { test: /.mp4$/, type: 'video/mp4', binary: true },
  { test: /.mpeg$/, type: 'video/mpeg', binary: true },
  { test: /.webm$/, type: 'video/webm', binary: true },
  { test: /.pdf$/, type: 'application/pdf', binary: true },
  { test: /.tar$/, type: 'application/x-tar', binary: true },
  { test: /.zip$/, type: 'application/zip', binary: true },
  { test: /.eot$/, type: 'application/vnd.ms-fontobject', binary: true },
  { test: /.otf$/, type: 'font/otf', binary: true },
  { test: /.ttf$/, type: 'font/ttf', binary: true },
];