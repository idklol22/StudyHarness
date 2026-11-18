/**
 * The app's Study service instance: the library under `<data>/study` with the native PDF engine
 * (pdf-pages.ts). Everything that changes subjects, topics or materials goes through this.
 */
import { studyStore } from "../store/study.ts";
import { createStudyService } from "./study.ts";
import { pdfPageCount, pdfPageTexts, renderPdfPages } from "./pdf-pages.ts";

export const study = createStudyService(studyStore, { pageCount: pdfPageCount, texts: pdfPageTexts, render: renderPdfPages });
