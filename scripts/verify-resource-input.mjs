// CI FLOW RULE (S00): the legacy receiver downloaded the complete production
// Actions ZIP and extracted tier archives. It is retired until plugin updates
// consume candidate-set pages and fetch only metadata/scope packages.
throw new Error('aggregate resource receiver is retired; plugin updates require the small-package protocol');
