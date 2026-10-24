# Krav från appen till servern (Del A)

Det här behöver StudFun 1.0 på servern. Läs det tillsammans med Del A i `STUDFUN-1.0/BYGG-PROMPT-VERSION-1.md`.

## Node

* **Servern har i dag Node v20.20.2** (kontrollerat med `node --version` den 24 oktober 2026). Det räcker inte. Den inbyggda databasen `node:sqlite` kräver **22.5 eller senare**.
* **StudFun 1.0 ska köras med en egen Node i en separat miljö**, ungefär som en venv i Python:
  * en egen Node, 22.5 eller senare (gärna aktuell LTS), packas upp i StudFun 1.0:s egen mapp, till exempel `/opt/studfun-uni/node/`;
  * tjänsten för StudFun 1.0 startar den med hela sökvägen, till exempel `/opt/studfun-uni/node/bin/node server.js`;
  * systemets Node 20 rörs inte. Dagens StudFun, AI‑assistenten och allt annat fortsätter använda den;
  * ångra: stoppa tjänsten och radera mappen.
* På Node 22.5 till 22.12 behöver startkommandot flaggan `--experimental-sqlite`. Från 22.13 behövs den inte, men den gör ingen skada.
