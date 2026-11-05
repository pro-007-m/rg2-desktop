"""Reproducible import of functional cube notation only; no article prose.

SpeedCubeDB category pages contain four alternatives per orientation and explicit
More Algorithms buttons. Every advertised (case,orientation) endpoint is fetched;
the importer checks for further More buttons and records request hashes/counts.
Existing imported HTTP snapshots are represented by their hashes in provenance,
not silently treated as a live view. --offline reuses this exact imported version.
"""
from __future__ import annotations
import argparse
import concurrent.futures
import hashlib
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/solver/algorithm-data.json"
SOURCES = ROOT / "docs/solver-sources.json"
DATE = "2026-11-05"
FAMILIES = ("F2L", "OLL", "COLL", "PLL")
BASE = "https://speedcubedb.com"
REQUESTS: list[dict] = []

def fetch(url: str) -> str:
    last = None
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "RG2-Desktop-Personal-Catalog-Import/1.0", "Accept": "text/html"})
            with urllib.request.urlopen(request, timeout=45) as response:
                raw = response.read()
            body = raw.decode("utf-8")
            if body.strip() == "error":
                raise ValueError("Source endpoint returned an error marker")
            REQUESTS.append({"url": url, "fetchedOn": DATE, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
            return body
        except Exception as error:
            last = error
            if attempt < 3:
                time.sleep(1.0 * (attempt + 1))
    raise RuntimeError(f"Cannot import {url}: {last}")

def attributes(tag: str) -> dict[str, str]:
    return {key: html.unescape(value) for key, _, value in re.findall(r"([\w-]+)\s*=\s*([\"'])(.*?)\2", tag, re.S)}

def plain(value: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", value)).strip()

def case_blocks(body: str):
    starts = list(re.finditer(r'<div\b[^>]*class="[^"]*\bsinglealgorithm\b[^>]*>', body))
    for index, match in enumerate(starts):
        attrs = attributes(match.group(0))
        yield attrs, body[match.end(): starts[index + 1].start() if index + 1 < len(starts) else len(body)]

def read_formulas(body: str, family: str, case: str, default_orientation: int, retrieval_url: str):
    result = []
    for match in re.finditer(r'<div\b[^>]*class="[^"]*\bformatted-alg\b[^>]*>(.*?)</div>', body, re.S):
        raw = plain(match.group(1))
        if not raw:
            continue
        before = body[:match.start()]
        orientations = re.findall(r"<div\b[^>]*data-ori=['\"](\d+)['\"]", before)
        orientation = int(orientations[-1]) if orientations else default_orientation
        li_start = before.rfind("<li")
        li_end = body.find("</li>", match.end())
        row = body[max(0, li_start): li_end if li_end >= 0 else match.end()]
        source_alt = re.search(r"data-altid=['\"](\d+)", row)
        case_url = f"{BASE}/a/3x3/{family}/{urllib.parse.quote(case, safe='')}"
        source = {"name": "SpeedCubeDB", "url": case_url, "retrievedFrom": retrieval_url, "date": DATE, "label": f"{family} · {case}", "orientation": orientation}
        if source_alt:
            source["alternativeId"] = int(source_alt.group(1))
        key = f"SCDB|{family}|{case}|{orientation}|{raw}"
        result.append({"id": "scdb-" + hashlib.sha256(key.encode()).hexdigest()[:20], "family": family, "caseId": case, "title": f"{family} · {case}", "rawAlg": raw, "source": source})
    return result

def import_speedcubedb():
    records, jobs, families = [], [], {}
    for family in FAMILIES:
        url = f"{BASE}/a/3x3/{family}"
        body = fetch(url)
        cases = []
        for attrs, block in case_blocks(body):
            case = attrs["data-alg"]
            cases.append(case)
            records.extend(read_formulas(block, family, case, 0, url))
            # The separately labelled Standard Alg is functional notation too.
            standard = re.search(r"<!-- standard alg -->.*?Standard Alg:</div>(.*?)</div>", block, re.S)
            if standard and plain(standard.group(1)):
                raw = plain(standard.group(1))
                key = f"SCDB|{family}|{case}|standard|{raw}"
                records.append({"id": "scdb-" + hashlib.sha256(key.encode()).hexdigest()[:20], "family": family, "caseId": case, "title": f"{family} · {case}", "rawAlg": raw, "source": {"name": "SpeedCubeDB", "url": f"{url}/{urllib.parse.quote(case, safe='')}", "retrievedFrom": url, "date": DATE, "label": f"{family} · {case} · Standard Alg", "orientation": 0, "standard": True}})
            for button in re.findall(r"<button\b[^>]*class=['\"][^'\"]*\bmore-algs\b[^>]*>", block):
                more = attributes(button)
                query = urllib.parse.urlencode({"algname": more["data-algname"], "cat": more["data-category"], "d": more["data-d"]})
                jobs.append((family, case, int(more["data-d"]), f"{BASE}/category.algs.php?{query}"))
        families[family] = {"category": url, "caseCount": len(cases), "caseIds": cases, "moreEndpoints": sum(job[0] == family for job in jobs)}
        print(f"{family}: {len(cases)} source cases, {families[family]['moreEndpoints']} advertised variant lists", flush=True)

    def fetch_job(job):
        family, case, orientation, url = job
        body = fetch(url)
        if re.search(r"\bmore-algs\b|\bpagination\b", body):
            raise RuntimeError(f"Unresolved pagination at {url}")
        parsed = read_formulas(body, family, case, orientation, url)
        entry = next(item for item in reversed(REQUESTS) if item["url"] == url)
        entry.update({"family": family, "caseId": case, "orientation": orientation, "formulaCount": len(parsed), "furtherMoreButtons": 0})
        return parsed

    # Three concurrent public requests; no credentials, sessions or voting APIs.
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        pending = [pool.submit(fetch_job, job) for job in jobs]
        for index, future in enumerate(concurrent.futures.as_completed(pending), 1):
            records.extend(future.result())
            if index % 25 == 0 or index == len(jobs):
                print(f"Variant lists: {index}/{len(jobs)}; records so far {len(records)}", flush=True)
    return records, families

class TextBlocks(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks, self.current, self.skip = [], [], 0
    def flush(self):
        text = "".join(self.current).strip()
        if text:
            self.blocks.append(text)
        self.current = []
    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.skip += 1
        if tag in {"p", "div", "br", "li", "td", "h1", "h2", "h3"}:
            self.flush()
    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.skip = max(0, self.skip - 1)
        if tag in {"p", "div", "li", "td", "h1", "h2", "h3"}:
            self.flush()
    def handle_data(self, text):
        if not self.skip:
            self.current.append(text)

def import_rg2():
    source_path = ROOT / "data/catalog.json"
    catalog = json.loads(source_path.read_text(encoding="utf-8-sig"))
    documents = []
    for phase in catalog["phases"]:
        phase_id = phase["id"]
        if phase_id not in {"OLL", "COLL", "PLL", "F2L", "INT_F2L", "ADV_F2L"}:
            continue
        family = phase_id if phase_id in {"OLL", "COLL", "PLL"} else "F2L"
        for item in phase["items"]:
            parser = TextBlocks()
            parser.feed(item.get("html", ""))
            parser.flush()
            documents.append({"family": family, "phaseId": phase_id, "itemId": item["id"], "itemIndex": item.get("index", 0), "title": item["title"], "blocks": parser.blocks})
    bridge = r"""
const fs=require('fs'),formatter=require(process.argv[1]);
const documents=JSON.parse(fs.readFileSync(0,'utf8'));
for(const doc of documents){doc.formulas=doc.blocks.flatMap(text=>formatter.splitAlgorithms(text,{minMoves:3}).filter(part=>part.type==='algorithm').map(part=>part.text));delete doc.blocks;}
process.stdout.write(JSON.stringify(documents));
"""
    # The bundled executable is runnable inside the Windows workspace sandbox;
    # a bare name may resolve to the unrelated user-installed Node distribution.
    node = Path(sys.executable).parents[1] / "node/bin/node.exe"
    parsed = subprocess.run([str(node), "-e", bridge, str(ROOT / "data/algorithms.js")], input=json.dumps(documents, ensure_ascii=False), capture_output=True, text=True, encoding="utf-8", check=True)
    records = []
    for document in json.loads(parsed.stdout):
        for raw in document["formulas"]:
            key = "RG2|" + document["itemId"] + "|" + raw
            records.append({"id": "rg2-" + hashlib.sha256(key.encode()).hexdigest()[:20], "family": document["family"], "caseId": document["itemId"], "title": document["title"], "rawAlg": raw, "source": {"name": "RG2 original APK", "url": f"rg2://pager?phase={document['phaseId']}&item={document['itemIndex']}", "date": DATE, "label": document["title"], "itemId": document["itemId"], "apkSha256": catalog["provenance"]["apkSha256"]}})
    return records, {"path": "data/catalog.json", "sha256": hashlib.sha256(source_path.read_bytes()).hexdigest(), "date": DATE, "formulaCount": len(records), "formatter": "data/algorithms.js RG2Algorithms.splitAlgorithms; minMoves=3", "copiedArticleProse": False}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true", help="Validate existence and report the fixed imported version without contacting sources")
    args = parser.parse_args()
    if args.offline:
        data = json.loads(OUTPUT.read_text(encoding="utf-8"))
        print(json.dumps({"version": data["version"], "records": len(data["records"]), "sources": data["coverage"]}, ensure_ascii=False, indent=2))
        return
    local, rg2 = import_rg2()
    print(f"RG2: {len(local)} functional formula occurrences extracted with the existing formatter", flush=True)
    online, families = import_speedcubedb()
    seen = {}
    for record in online + local:
        # Exact repeated appearances of one source record are redundant. Distinct
        # move strings and distinct sources are kept for later core verification.
        seen[record["id"]] = record
    records = sorted(seen.values(), key=lambda value: (value["family"], value["caseId"], value["id"]))
    coverage = {family: {**families[family], "rawFormulaRecords": sum(record["family"] == family for record in records), "onlineFormulaRecords": sum(record["family"] == family and record["source"]["name"] == "SpeedCubeDB" for record in records)} for family in FAMILIES}
    data = {"schemaVersion": 1, "version": f"rg2-scdb-{DATE}", "importedOn": DATE, "description": "Functional move sequences and source case labels only; every advertised SpeedCubeDB More Algorithms endpoint consumed.", "coverage": coverage, "records": records}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    manifest = {"schemaVersion": 1, "importedOn": DATE, "version": data["version"], "publicFunctionalFormulasOnly": True, "noCredentialsUsed": True, "noTopNLimit": True, "pagination": "Every category More Algorithms button was fetched; all returned lists had no further More/Pagination controls.", "concurrency": 3, "families": coverage, "localRG2": rg2, "requests": sorted(REQUESTS, key=lambda item: item["url"]), "outputSha256": hashlib.sha256(OUTPUT.read_bytes()).hexdigest()}
    SOURCES.parent.mkdir(parents=True, exist_ok=True)
    SOURCES.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"records": len(records), "families": coverage, "httpRequests": len(REQUESTS)}, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
