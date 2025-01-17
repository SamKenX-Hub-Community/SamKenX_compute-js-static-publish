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
import type { StoreEntry } from "../../types/compute.js";
import type { ContentCompressionTypes } from "../../constants/compression.js";

const decoder = new TextDecoder();

type SourceAndInfo<TSource> = {
  source: TSource,
  hash: string,
  size: number,
};

type SourceAndInfoForEncodingFn<TSource> = (contentEncoding: ContentCompressionTypes) => SourceAndInfo<TSource> | undefined;
function findMatchingSourceAndInfo<TSource>(acceptEncodingsGroups: ContentCompressionTypes[][], defaultSourceAndInfo: SourceAndInfo<TSource>, sourceAndInfoForEncodingFn: SourceAndInfoForEncodingFn<TSource>) {

  let sourceAndInfo: SourceAndInfo<TSource> | undefined;
  let contentEncoding: ContentCompressionTypes | null = null;
  if (acceptEncodingsGroups != null) {
    for(const encodingGroup of acceptEncodingsGroups) {
      const sourceAndInfosForEncodingsGroup = encodingGroup
        .map(encoding => ({ encoding, sourceAndInfo: sourceAndInfoForEncodingFn(encoding) }))
        .filter(x => x.sourceAndInfo != null) as {encoding: ContentCompressionTypes, sourceAndInfo: SourceAndInfo<TSource>}[];

      if (sourceAndInfosForEncodingsGroup.length === 0) {
        // If no encoding in this group is available then move to next group
        continue;
      }

      // Sort the items, putting the smallest size first
      sourceAndInfosForEncodingsGroup
        .sort((a, b) => a.sourceAndInfo.size - b.sourceAndInfo.size);

      // The first item is the one we want.
      sourceAndInfo = sourceAndInfosForEncodingsGroup[0].sourceAndInfo;
      contentEncoding = sourceAndInfosForEncodingsGroup[0].encoding;
      break;
    }
  }

  sourceAndInfo ??= defaultSourceAndInfo;

  return { sourceAndInfo, contentEncoding };
}

export class ContentInlineAsset implements ContentAsset {
  readonly isInline: boolean = true;

  private readonly metadata: ContentAssetMetadataMapEntryInline;

  private readonly sourceAndInfo: SourceAndInfo<Uint8Array>;
  private readonly compressedSourcesAndInfo: CompressedFileInfos<SourceAndInfo<Uint8Array>>;

  constructor(metadata: ContentAssetMetadataMapEntryInline) {
    this.metadata = metadata;

    this.sourceAndInfo = {
      source: includeBytes(metadata.fileInfo.staticFilePath),
      hash: metadata.fileInfo.hash,
      size: metadata.fileInfo.size,
    };

    this.compressedSourcesAndInfo = Object.entries(metadata.compressedFileInfos)
      .reduce<CompressedFileInfos<SourceAndInfo<Uint8Array>>>((obj, [key, value]) => {
        obj[key as ContentCompressionTypes] = {
          source: includeBytes(value.staticFilePath),
          hash: value.hash,
          size: value.size,
        };
        return obj;
      }, {});
  }

  get assetKey() {
    return this.metadata.assetKey;
  }

  async getStoreEntry(acceptEncodingsGroups: ContentCompressionTypes[][] = []): Promise<StoreEntry> {
    const { sourceAndInfo, contentEncoding } = findMatchingSourceAndInfo(acceptEncodingsGroups, this.sourceAndInfo, encoding => this.compressedSourcesAndInfo[encoding]);
    const { source, hash, size } = sourceAndInfo;
    return new InlineStoreEntry(source, contentEncoding, hash, size);
  }

  getBytes(): Uint8Array {
    return this.sourceAndInfo.source;
  }

  getText(): string {
    if (!this.metadata.text) {
      throw new Error("Can't getText() for non-text content");
    }
    return decoder.decode(this.sourceAndInfo.source);
  }

  getMetadata(): ContentAssetMetadataMapEntry {
    return this.metadata;
  }
}

export class ContentObjectStoreAsset implements ContentAsset {
  readonly isInline: boolean = false;

  private readonly metadata: ContentAssetMetadataMapEntryObjectStore;

  private readonly objectStoreName: string;

  private readonly sourceAndInfo: SourceAndInfo<string>;
  private readonly compressedSourcesAndInfo: CompressedFileInfos<SourceAndInfo<string>>;

  constructor(metadata: ContentAssetMetadataMapEntryObjectStore, objectStoreName: string) {
    this.metadata = metadata;
    this.objectStoreName = objectStoreName;

    this.sourceAndInfo = {
      source: metadata.fileInfo.objectStoreKey,
      hash: metadata.fileInfo.hash,
      size: metadata.fileInfo.size,
    };

    this.compressedSourcesAndInfo = Object.entries(metadata.compressedFileInfos)
      .reduce<CompressedFileInfos<SourceAndInfo<string>>>((obj, [key, value]) => {
        obj[key as ContentCompressionTypes] = {
          source: value.objectStoreKey,
          hash: value.hash,
          size: value.size,
        };
        return obj;
      }, {});
  }

  get assetKey() {
    return this.metadata.assetKey;
  }

  async getStoreEntry(acceptEncodingsGroups: ContentCompressionTypes[][] = []): Promise<StoreEntry> {

    const { sourceAndInfo, contentEncoding } = findMatchingSourceAndInfo(acceptEncodingsGroups, this.sourceAndInfo, encoding => this.compressedSourcesAndInfo[encoding]);

    const objectStore = new ObjectStore(this.objectStoreName);
    let retries = 3;
    while (retries > 0) {
      const storeEntry = await objectStore.get(sourceAndInfo.source);
      if (storeEntry != null) {
        const { hash, size } = sourceAndInfo;
        return Object.assign(storeEntry, { contentEncoding, hash, size });
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

      this.initAsset(assetKey, asset);
    }
  }
}
