export type ProviderId = 'codex' | 'antigravity';

export type ProviderStatus = {
  id: ProviderId;
  label: string;
  installed: boolean;
  enabled: boolean;
  version?: string;
  message: string;
  models: ModelInfo[];
};

export type ModelInfo = {
  id: string;
  displayName: string;
  available: 'catalog' | 'verified' | 'unknown';
  imageCapability: 'verified' | 'unverified' | 'unavailable';
};

export type ImageArtifact = {
  originalName: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  bytes: number;
  sha256: string;
};

export type ArticleTask = {
  id: string;
  sourceName: string;
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  coverAlt: string;
  prompt: string;
  promptVersion: string;
  body: string;
  format?: 'markdown' | 'html';
  entryPath?: string;
  entryCandidates?: string[];
  resourceManifest?: ResourceManifestItem[];
  fileManifest?: FileManifestItem[];
  fullPagePreviewUrl?: string;
  warnings: string[];
  blockers?: string[];
  status: 'draft' | 'generating' | 'ready' | 'prepared' | 'previewing' | 'committed' | 'published' | 'failed';
  error?: string;
  cover?: ImageArtifact;
  targetPath?: string;
  articlePath?: string;
  coverPath?: string;
  previewUrl?: string;
  articlePreviewUrl?: string;
  currentBranch?: string;
  diff?: DiffFile[];
  commitHash?: string;
  pushTarget?: string;
};

export type ResourceManifestItem = {
  path: string;
  kind: 'image' | 'style' | 'script' | 'font' | 'media' | 'document' | 'other';
  status: 'ready' | 'unused' | 'external' | 'missing' | 'blocked';
  bytes?: number;
  references: string[];
  reason?: string;
};

export type FileManifestItem = { path: string; bytes: number; sha256: string; kind: 'metadata' | 'html' | 'resource' | 'cover' };

export type DiffFile = {
  path: string;
  change: 'added' | 'modified';
  patch: string;
};

export type ProgressEvent = {
  taskId: string;
  at: string;
  stage: 'description' | 'cover' | 'prepare' | 'preview' | 'publish';
  message: string;
  status: 'running' | 'complete' | 'failed';
};

export type PreviewContext = {
  homeUrl: string;
  articleUrl: string;
  fullPageUrl?: string;
  branch: string;
  pushTarget: string;
};

export type ApiError = { error: string };
