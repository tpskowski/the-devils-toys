# Corrections

Toybox reprints no source, so there is nothing to correct.

The file exists because `system.json` names a `correctionsFile`, and a system
that reprints someone else's book must carry the record of what it changed. The
fixture declares one so that the code path which reads, bundles, and installs a
corrections file is exercised by the test suite rather than only by the systems
that ship outside this repository.
