export type {
  AnnotationCodeRef,
  AnnotationDraft,
  AnnotationEntry,
  AnnotationLocationResolution,
  AnnotationScope,
  AnnotationType,
  AnnotationTypeOption,
} from "./annotations/model";
export {
  getAnnotationTypeOptions,
  normalizeAnnotationScope,
} from "./annotations/model";
export { formatAnnotationLocation } from "./annotations/presentation";
export type { AnnotationList } from "./annotations/lists";
export {
  createAnnotationList,
  getNamedAnnotationListsPath,
  loadAnnotationLists,
} from "./annotations/lists";
export {
  appendAnnotation,
  deleteAnnotation,
  ensureAnnotationsDocument,
  findAnnotationSection,
  getAnnotationsDocumentPath,
  getAnnotationsDocumentUri,
  isAnnotationsDocument,
  loadAnnotations,
  updateAnnotationCodeRef,
} from "./annotations/storage";
export {
  canFixAnnotationLocation,
  resolveAnnotationLocation,
} from "./annotations/resolution";
export {
  AnnotationListTreeItem,
  AnnotationTreeItem,
  AnnotationTreeProvider,
} from "./annotations/tree";
