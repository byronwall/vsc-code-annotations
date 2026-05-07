export type {
  AnnotationCodeRef,
  AnnotationDraft,
  AnnotationEntry,
  AnnotationLocationResolution,
  AnnotationType,
  AnnotationTypeOption,
} from "./annotations/model";
export { getAnnotationTypeOptions } from "./annotations/model";
export { formatAnnotationLocation } from "./annotations/presentation";
export {
  appendAnnotation,
  ensureAnnotationsDocument,
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
export { AnnotationTreeItem, AnnotationTreeProvider } from "./annotations/tree";
