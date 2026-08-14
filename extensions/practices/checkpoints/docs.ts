import type { Checkpoint, WorkState } from "../../core/types";
import { extractToolPath, findReadEvidenceForPath, findWriteEditForPath, isWriteLike, objectAt, pathAllowedForDocs, stringAt, stringList } from "../helpers";
import { notSatisfied, satisfied } from "./common";

const docTypes = new Set(["readme", "guide", "runbook", "adr", "rfc", "config-doc", "review-report", "audit-report", "other"]);

export const docsScopeRecordedCheckpoint: Checkpoint = {
  id: "docs-scope-recorded",
  rule: "docs must record the audience, doc type, and target files, and confirm there is no runtime behavior change.",
  check(work) {
    const scope = objectAt(objectAt(work.completionEvidence?.docs)?.scope);
    if (!scope) return notSatisfied("missing completionEvidence.docs.scope");
    if (!stringAt(scope.audience)) return notSatisfied("docs.scope.audience must not be empty");
    const docType = stringAt(scope.docType);
    if (!docTypes.has(docType)) return notSatisfied("docs.scope.docType must be readme / guide / runbook / adr / rfc / config-doc / review-report / audit-report / other");
    if (stringList(scope.filesTargeted).length === 0) return notSatisfied("docs.scope.filesTargeted[] must not be empty");
    if (scope.behaviorChangeIncluded !== false) return notSatisfied("docs.scope.behaviorChangeIncluded must be explicitly false; for real runtime config/CI/build changes, use develop instead");
    return satisfied(`docs scope recorded: ${docType}`);
  },
};

export const docsSourcesEvidencedCheckpoint: Checkpoint = {
  id: "docs-sources-evidenced",
  rule: "Project files/external sources that docs claims to reference must have real read/search/fetch evidence.",
  check(work) {
    const sources = objectAt(objectAt(work.completionEvidence?.docs)?.sources);
    if (!sources) return notSatisfied("missing completionEvidence.docs.sources");
    for (const file of stringList(sources.projectFilesRead)) {
      if (!findReadEvidenceForPath(work, file)) return notSatisfied(`docs.sources.projectFilesRead missing real read evidence: ${file}`);
    }
    const externalSources = Array.isArray(sources.externalSources) ? sources.externalSources : [];
    if (externalSources.length > 0 && !hasSearchOrFetchEvidence(work)) return notSatisfied("docs.sources.externalSources is non-empty, but there is no real cynos_search/cynos_fetch evidence");
    return satisfied("docs sources recorded and backed by evidence");
  },
};

export const docsFilesWrittenCheckpoint: Checkpoint = {
  id: "docs-files-written",
  rule: "docs changes.filesChanged must have real write/edit evidence, and may only be documentation/text/example-explanation files; runtime behavior configs must go to develop.",
  check(work) {
    const docs = objectAt(work.completionEvidence?.docs);
    const changes = objectAt(docs?.changes);
    if (!changes) return notSatisfied("missing completionEvidence.docs.changes");
    if (!stringAt(changes.summary)) return notSatisfied("docs.changes.summary must not be empty");

    const capturedWrites = successfulWrites(work);
    const forbiddenWrite = capturedWrites.find((result) => {
      const path = extractToolPath(result);
      return !path || !pathAllowedForDocs(path, work.cwd);
    });
    if (forbiddenWrite) {
      const path = extractToolPath(forbiddenWrite) || "<unknown path>";
      return notSatisfied(`docs is not allowed to write ${path}; docs only allows documentation/text/example-explanation files; for code/tests/CI/package/config/real runtime config, use develop instead`);
    }

    const filesChanged = stringList(changes.filesChanged);
    if (filesChanged.length === 0) return notSatisfied("docs.changes.filesChanged[] must not be empty");
    for (const file of filesChanged) {
      if (!pathAllowedForDocs(file, work.cwd)) return notSatisfied(`docs.changes.filesChanged contains a disallowed path: ${file}`);
      const evidence = findWriteEditForPath(work, file);
      if (!evidence) return notSatisfied(`docs.changes.filesChanged missing real write/edit evidence: ${file}`);
    }
    return satisfied(`docs wrote ${filesChanged.length} doc files`);
  },
};

function successfulWrites(work: WorkState) {
  return (work.capturedToolResults ?? []).filter((result) => isWriteLike(result) && !result.isError);
}

function hasSearchOrFetchEvidence(work: WorkState): boolean {
  return (work.capturedToolResults ?? []).some((result) => !result.isError && ["cynos_search", "cynos_fetch"].includes(result.toolName));
}
