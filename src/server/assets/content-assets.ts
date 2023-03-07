import { includeBytes } from "fastly:experimental";
import { ObjectStore } from "fastly:object-store";

import { AssetManager } from "./asset-manager.js";
import { InlineStoreEntry } from "../object-store/inline-store-entry.js";

import type {
  CompressedFileInfos,
  ContentAsset,
  ContentAssetMetadataMap,
  ContentAssetMetadataMapEntry,
  ContentAssetMetadataMapEntryInline,
  ContentAssetMetadataMapEntryObjectStore
} from "../../types/content-assets.js";
import type { StoreEntryInfo } from "../../types/compute.js";
import type { ContentCompressionTypes } from "../../constants/compression.js";

const decoder = new TextDecoder();

type SourceAndHash<TSource> = {
  source: TSource,
  hash: string,
};

export class ContentInlineAsset implements ContentAsset {
  readonly isInline: boolean = true;

  private readonly metadata: ContentAssetMetadataMapEntryInline;

  private readonly sourceAndHash: SourceAndHash<Uint8Array>;
  private readonly compressedSourcesAndHashes: CompressedFileInfos<SourceAndHash<Uint8Array>>;

  constructor(metadata: ContentAssetMetadataMapEntryInline) {
    this.metadata = metadata;

    this.sourceAndHash = {
      source: includeBytes(metadata.fileInfo.staticFilePath),
      hash: metadata.fileInfo.hash,
    };

    this.compressedSourcesAndHashes = Object.entries(metadata.compressedFileInfos)
      .reduce<CompressedFileInfos<SourceAndHash<Uint8Array>>>((obj, [key, value]) => {
        obj[key as ContentCompressionTypes] = {
          source: includeBytes(value.staticFilePath),
          hash: value.hash,
        };
        return obj;
      }, {});
  }

  get assetKey() {
    return this.metadata.assetKey;
  }

  async getStoreEntryInfo(acceptEncodings?: ContentCompressionTypes[]): Promise<StoreEntryInfo> {
    let sourceAndHash: SourceAndHash<Uint8Array> | undefined;
    let contentEncoding: ContentCompressionTypes | null = null;
    if (acceptEncodings != null) {
      for(const encoding of acceptEncodings) {
        sourceAndHash = this.compressedSourcesAndHashes[encoding];
        if (sourceAndHash != null) {
          contentEncoding = encoding;
          break;
        }
      }
    }
    sourceAndHash ??= this.sourceAndHash;

    const storeEntry = new InlineStoreEntry(sourceAndHash.source);
    const hash = sourceAndHash.hash;
    return { storeEntry, contentEncoding, hash };
  }

  getBytes(): Uint8Array {
    return this.sourceAndHash.source;
  }

  getText(): string {
    if (!this.metadata.text) {
      throw new Error("Can't getText() for non-text content");
    }
    return decoder.decode(this.sourceAndHash.source);
  }

  getMetadata(): ContentAssetMetadataMapEntry {
    return this.metadata;
  }
}

export class ContentObjectStoreAsset implements ContentAsset {
  readonly isInline: boolean = false;

  private readonly metadata: ContentAssetMetadataMapEntryObjectStore;

  private readonly objectStoreName: string;

  private readonly sourceAndHash: SourceAndHash<string>;
  private readonly compressedSourcesAndHashes: CompressedFileInfos<SourceAndHash<string>>;

  constructor(metadata: ContentAssetMetadataMapEntryObjectStore, objectStoreName: string) {
    this.metadata = metadata;
    this.objectStoreName = objectStoreName;

    this.sourceAndHash = {
      source: metadata.fileInfo.objectStoreKey,
      hash: metadata.fileInfo.hash,
    };

    this.compressedSourcesAndHashes = Object.entries(metadata.compressedFileInfos)
      .reduce<CompressedFileInfos<SourceAndHash<string>>>((obj, [key, value]) => {
        obj[key as ContentCompressionTypes] = {
          source: value.objectStoreKey,
          hash: value.hash,
        };
        return obj;
      }, {});
  }

  get assetKey() {
    return this.metadata.assetKey;
  }

  async getStoreEntryInfo(acceptEncodings: ContentCompressionTypes[] = []): Promise<StoreEntryInfo> {
    let sourceAndHash: SourceAndHash<string> | undefined;
    let contentEncoding: ContentCompressionTypes | null = null;
    if (acceptEncodings != null) {
      for(const encoding of acceptEncodings) {
        sourceAndHash = this.compressedSourcesAndHashes[encoding];
        if (sourceAndHash != null) {
          contentEncoding = encoding;
          break;
        }
      }
    }
    sourceAndHash ??= this.sourceAndHash;
    const hash = sourceAndHash.hash;

    const objectStore = new ObjectStore(this.objectStoreName);
    let retries = 3;
    while (retries > 0) {
      const storeEntry = await objectStore.get(sourceAndHash.source);
      if (storeEntry != null) {
        return { storeEntry, contentEncoding, hash };
      }

      // Note the null does NOT mean 404. The fact that we are here means
      // metadata exists for this path, and we're just trying to get the data from
      // the object store.

      // So if we're here then the data is either not available yet (in which case
      // we can wait just a bit and try again), or the data was deleted.
      retries--;

      // We're going to wait 250ms/500ms/750ms and try again.
      const delay = (3-retries) * 250;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    throw new Error("Asset could not be retrieved from the Object Store.");
  }

  getBytes(): Uint8Array {
    throw new Error("Can't getBytes() for Object Store asset");
  }

  getText(): string {
    throw new Error("Can't getText() for Object Store asset");
  }

  getMetadata(): ContentAssetMetadataMapEntry {
    return this.metadata;
  }

}

export class ContentAssets extends AssetManager<ContentAsset> {

  constructor(objectStoreName: string | null, contentAssetMetadataMap: ContentAssetMetadataMap) {
    super();

    for (const [assetKey, metadata] of Object.entries(contentAssetMetadataMap)) {

      let asset: ContentAsset;
      if (metadata.isInline) {

        asset = new ContentInlineAsset(metadata);

      } else {

        if (objectStoreName == null) {
          throw new Error("Unexpected! Object Store should be specified!!");
        }

        asset = new ContentObjectStoreAsset(metadata, objectStoreName);
      }

      this.setAsset(assetKey, asset);
    }
  }
}