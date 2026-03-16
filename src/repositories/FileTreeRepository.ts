import fs from 'fs';
import path from 'path';

export type FileDepthMap = Record<string, number>;

export class FileTreeRepository {
  public readonly defaultRoot: string;

  constructor(defaultRoot: string = 'TestFilesDirectory') {
    this.defaultRoot = defaultRoot;
  }

  /**
   * Recursively reads files under rootDir and returns a map of absolute file paths to depth.
   * Depth is 1 for files directly in the root directory, 2 for one level deeper, etc.
   */
  public async getFileDepthMap(
    rootDir: string = this.defaultRoot,
    extensions?: string[]
  ): Promise<FileDepthMap> {
    const resolvedRoot = path.resolve(rootDir);
    const normalizedExts = this.normalizeExtensions(extensions);
    const result: FileDepthMap = {};

    await this.walk(resolvedRoot, resolvedRoot, normalizedExts, result);
    return result;
  }

  private async walk(
    currentDir: string,
    rootDir: string,
    extensions: Set<string> | null,
    result: FileDepthMap
  ): Promise<void> {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await this.walk(fullPath, rootDir, extensions, result);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (extensions && !extensions.has(this.getExtension(entry.name))) {
        continue;
      }

      const depth = this.getDepth(fullPath, rootDir);
      result[fullPath] = depth;
    }
  }

  private getDepth(filePath: string, rootDir: string): number {
    const relative = path.relative(rootDir, filePath);
    const segments = relative.split(path.sep);
    return Math.max(1, segments.length);
  }

  private normalizeExtensions(extensions?: string[]): Set<string> | null {
    if (!extensions || extensions.length === 0) return null;
    const normalized = extensions.map((ext) => {
      const trimmed = ext.trim();
      return trimmed.startsWith('.') ? trimmed.toLowerCase() : `.${trimmed.toLowerCase()}`;
    });
    return new Set(normalized);
  }

  private getExtension(fileName: string): string {
    return path.extname(fileName).toLowerCase();
  }
}
