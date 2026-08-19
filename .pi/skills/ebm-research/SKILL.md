---
name: ebm-research
description: Evidence-Based Medicine research workflow. Use when answering clinical questions, building PICO, searching biomedical literature/guidelines, extracting exact evidence quotes, or drafting EBM reports.
---

# EBM Research

## Rules

1. Use only the relevant PICO elements when they clarify a comparative foreground question; do not require a complete PICO or force background, causal, diagnostic, risk, prognostic, implementation, or single-arm questions into it. Convert the user's broad query into the smallest set of decision-changing EBM sub-questions, then into claim-level evidence needs. When the user names specific outcomes (for example DFS, OS, recurrence, severe adverse events), preserve them as evidence concerns inside the relevant sub-questions rather than forcing a table or one-section-per-outcome structure.
2. Prefer authoritative clinical practice guidelines, systematic reviews, RCTs, then observational/regulatory/background sources. Do not treat expert consensus as equivalent to an authoritative guideline: in Chinese clinical contexts, national/official society guidelines usually carry much more decision weight than expert consensus documents, which may reflect opinion or local practice and may not be independently validated.
3. Archive source material before using it as evidence.
4. In expert mode, add evidence after reading an archived source. With `read_id`, use the matching absolute `line_start`/`line_end`; when the decision-relevant passage is no more than 12 source lines, that bounded range may be registered without copied anchors. For broader ranges, also use both short `start_text`/`end_text` boundaries. Alternatively use `source_path` with `line_start`/`line_end`; source_path is optional when read_id is present and text anchors are optional in line-range mode. In read_id mode, a failed match is a prompt to use the known tight range, choose more distinctive boundaries, or reread a narrower window, never a reason to archive a broad whole read range. In line-range mode, the explicitly supplied range is the locator. Never invent or repair clinical numbers, drug names, or wording. Treat evidence records as claim-linked candidates, not final conclusions, and choose confidence according to the model's judgment. In quick mode, do not create evidence records: retain only actual read-source IDs for automatic citations.
5. Report uncertainty and evidence gaps explicitly.
6. Do not invent citations or guideline recommendations. In expert reports, body citations must be numbered (`[1]`, `[2]`), not raw evidence IDs; raw `ev_...` IDs should be passed through `report_write.references` for hidden verification and should not appear in the user-facing Markdown. In quick mode, use the mode-specific Source ID marker protocol rather than manually writing numbered citations.
7. Optimize for the clinical information need, not possession of one specific document.
8. Treat ordinary web-search snippets and search snapshots as discovery only. An archived article or guideline mirror may be cited with its actual provenance; an unverified mirror must not be described as an official guideline.
9. Preserve the user's exact comparator. Evidence comparing HDAC with SDAC, for example, is indirect for a question comparing HDAC monotherapy with standard-dose multi-agent consolidation and cannot establish the requested ranking.
10. Track access to a named study by evidence level rather than calling it simply “unavailable”: `full_text`, `abstract_only`, `identifier_only`, or `not_found`. A complete PubMed abstract means `abstract_only`, not unavailable, and may already be sufficient. Use at most two targeted discovery attempts for the same named study: first an exact PMID/DOI/title lookup; second only when it uses a genuinely new identifier or route (for example PMC, publisher, repository, or OA PDF). A paraphrased query is not a new route. After explicit `abstract_only`, no-OA, reader failure, or two exact no-match outcomes, record the reachable level and pivot unless fuller text could materially change the decision. For PubMed specifically, do not use long natural-language comparator sentences as repeated queries; use a ladder: PMID/DOI → exact title phrase → first author + distinctive title words → short disease + intervention + study type query. PubMed queries should be compact keyword combinations, usually 3-7 meaningful terms plus at most one field/study-type filter; avoid stuffing every PICO element into one query.

## Evidence authority and consensus handling

Rank sources by both evidence type and issuing authority. For Chinese clinical questions, distinguish at least:

1. Authoritative clinical practice guideline: national commission/official specialty society guideline, formal guideline methods, explicit recommendations, evidence grading, update/version date. This can establish standard practice when applicable.
2. International or foreign authoritative guideline: strong source, but check local applicability, drug availability, thresholds, population, and whether Chinese guidance differs.
3. Systematic review/meta-analysis or pivotal RCT: strong for efficacy/safety claims, especially when newer than the guideline or when it could update the guideline frame.
4. Expert consensus/position statement: useful for practical framing, rare situations, or areas without formal guidelines, but lower authority than a guideline. Treat as consensus-level support, not validated guideline evidence, unless it explicitly reports formal methodology and evidence grading.
5. Narrative review, educational article, webpage, or local protocol: background/discovery unless read and directly traceable; do not let it override guidelines or primary evidence.

When a source says “专家共识”, “共识意见”, “position statement”, or similar, do not cite it as “指南” and do not let it carry the same force as an official guideline. If only consensus evidence exists, say so explicitly and lower confidence or mark the conclusion as conditional. If a consensus conflicts with an authoritative guideline, prefer the guideline unless newer primary evidence explains the divergence.

## Clinical cognition before search

Before choosing tools, classify the clinical role of the user's question. This is medical know-how, not a formal label:

- Eligibility/contraindication question: first find authoritative thresholds, exclusion criteria, and what other conditions must still be checked. A single condition being acceptable does not mean the whole intervention is approved.
- Treatment choice question: identify the competing options, patient subgroup, benefit outcomes, harm outcomes, and what result would change the ranking. If the user names outcomes, make sure the synthesis explains how those outcomes jointly affect the treatment choice; do not turn the report into a mechanical outcome table unless requested.
- Guideline implementation question: distinguish mandatory boundary, preferred option, optional recommendation, monitoring rule, and low-evidence practice suggestion.
- Diagnostic/prognostic question: identify reference standard, target condition, population, time horizon, and whether the result changes management.
- Evidence freshness question: use guidelines for the decision frame, then search only for recent evidence that could plausibly update or overturn that frame.

Use this clinical role to decide whether MCP, PubMed, web, or source reading comes first. The goal is not to collect more documents; it is to reduce the uncertainty that changes the clinical answer.

## Five-step EBM mapping (internal checklist)

Use the classic five-step cycle as a lightweight internal check: (1) frame the clinical decision and its smallest decision-changing questions; (2) retrieve the highest-authority, most direct evidence; (3) critically appraise validity, importance, consistency, harms, and applicability; (4) translate the synthesis into a conditional case-level recommendation; and (5) define what should be monitored and when the decision should be revisited. This is a reasoning aid, not a requirement to create five report sections or to expose a search log. Carry a step into the user-facing report only when it changes the conclusion, its boundary, or the follow-up plan.

## Query language and construction

Choose query language by source and task rather than mirroring the user mechanically:

- `source_library_search`: before any broad external `web_search`, and before repeated PubMed discovery attempts for a named study/topic, search the local library first. Use Chinese queries for Chinese guideline/library content and compact English queries for PubMed-like/library article content. If it returns a relevant `source_url`, call `web_read(url=...)`; this is usually a local-library read and avoids external search/parse latency.
- `guideline_mcp_*`: use the language most likely to match the local guideline corpus and clinical scenario. For Chinese clinical guideline questions or Chinese guideline retrieval, use Chinese terms first, including Chinese disease/intervention names. For international guideline or English-source retrieval, use English. `guideline_mcp_search` returns document candidates only; it must be followed by `guideline_mcp_read` before use. `guideline_mcp_retrieve` is temporarily disabled.
- `pubmed_search`: prefer English. Use short keyword combinations, not prose. Good forms are `disease intervention study-type`, `first-author exact-title-phrase`, or `drug disease outcome`. Use field tags only when they sharpen the search, for example `[tiab]`, `[pt]`, exact quoted title fragments, or PMID/DOI. Do not combine too many synonyms, comparators, outcomes, and filters in a single query; if needed, run one broad query and one targeted query rather than one overloaded query.
- `web_search`: use advanced search tactics when helpful: exact quotes for titles, organization/year terms for guidelines, site/domain hints such as `site:pmc.ncbi.nlm.nih.gov` or `site:nccn.org`, file/type hints such as `PDF` when seeking documents, and Chinese queries for Chinese society/journal pages. Web snippets remain discovery only until the underlying source is read.

A useful default ladder for a named paper is: PMID/DOI → exact title phrase → first author + distinctive title words → short disease + intervention + study type. For a guideline: organization + disease + year/version + key recommendation term, in the source language.

## Local-library-first cognition, then MCP/freshness correction

For guideline-answerable clinical questions, search the persistent local source library first. It contains sources accumulated from prior runs and is a discovery index, not a citation by itself. Use MCP to fill a genuine local-library gap, retrieve a focused guideline chunk, or resolve freshness/conflict questions.

Use this default sequence:

1. For each new sub-question, call `source_library_search` first. If it returns a directly relevant source URL, call `web_read` to reuse the local archive and read that source before MCP. Do not repeat the same library query after every tool result unless the sub-question or retrieval strategy changes.
2. If MCP returns traceable, official or clearly verified, recent-enough chunks that directly answer the claim, add them as evidence early.
3. If the guideline is older than about 3 years, the topic is fast-moving, the recommendation is controversial, or the MCP result only gives an indirect/secondary view, treat MCP as preliminary cognition and run targeted PubMed/Web update searches for only the claims that could change the answer.
4. Do not run MCP, broad PubMed, or web searches before the first local-library check for an ordinary clinical recommendation question, unless the local library is unavailable, the question explicitly asks for a named MCP guideline, or the topic is not represented locally.
5. In the final report, separate source roles in user-facing language: authoritative guidelines establish current standards and boundaries; primary studies and systematic reviews update, support, or challenge that standard; ordinary web/search snippets are discovery only unless the underlying source has been read and is citable. Do not mention internal acquisition routes such as MCP, PubMed tool calls, RAG chunks, archive paths, or evidence IDs in the report body.

## Guideline acquisition ladder

Use bounded escalation rather than repeatedly pursuing one unavailable guideline:

1. If the local source library is available, use `source_library_search` first for each new sub-question. When it returns a direct source URL, call `web_read(url=...)` to reuse the cached local copy in the current session. Search results and snippets are discovery only. Then use `guideline_mcp_search` for document identity or alternatives and `guideline_mcp_read` for the needed context, recommendation, date/version, applicability, or conflict resolution. `guideline_mcp_retrieve` is temporarily disabled.
2. Search the exact title, organization, year, and file type for a mirror.
3. Treat a mirror as verified only when title, issuer, version/year, pagination, and recommendation structure match authoritative metadata or an independent copy.
4. If direct text remains unavailable, use credible reviews, HTA/implementation documents, or later guidelines that quote or characterize the target.
5. For a clinical decision question, pivot to independent guidelines and primary studies addressing the same question.
6. Stop pursuing the target after bounded direct attempts unless its exact wording or recommendation grade could change the answer.

Preserve attribution boundaries:

- Official or verified mirrored text may support a direct statement about the guideline.
- A secondary direct quote supports “Source X quotes Guideline Y as stating …”.
- A secondary paraphrase supports only “Source X characterizes Guideline Y as …”.
- An independent guideline supports the clinical conclusion independently; it does not recover the unavailable target guideline.
- If the user asks for an exact recommendation or grade, indirect evidence is insufficient and the missing primary text must be disclosed.

## Research state behavior

For non-trivial EBM questions, the research frame is a decision aid, not a paperwork task. Use it only when it improves the next action, prevents drift, or records a belief change that will affect the report. Do not update the frame merely to satisfy a checklist.

Good state updates are short and action-oriented:

- After MCP gives useful cognition, record only the working belief that changes retrieval strategy: what the guideline seems to say, how authoritative/fresh it is, and whether a targeted PubMed/Web freshness check is still needed.
- After `evidence_add`, update state only if the evidence changes a claim, narrows applicability, reveals conflict, or justifies stopping retrieval.
- Before PubMed/Web after MCP, know the claim-level reason for the update search. If the reason is only “more literature might exist,” do not search broadly.
- Before `report_write`, you do not need a polished frame. You only need enough internal state to map final claims to numbered references and to distinguish source authority levels such as authoritative guideline, expert consensus, and primary study.

Prefer `research_frame_scratchpad_append` over full frame rewrites for lightweight observation → belief → next-action notes. If frame tools are disabled or the state is already obvious, proceed without blocking the answer.

## Minimal workflow

1. Choose frame timing by complexity. For complex, multi-claim, outcome-rich, or comparator-heavy EBM questions, call `research_frame_init` early to create the working canvas before broad retrieval. The frame should preserve the user's named outcomes as evidence concerns within clinically meaningful sub-questions, and distinguish direct from indirect evidence without forcing a table-shaped report. For narrow guideline-answerable questions such as thresholds, contraindications, eligibility, dosing boundaries, or monitoring rules, MCP may come first to acquire cognition; then initialize or append state only if it improves the next action, stop decision, or report mapping. In either path, state the overall clinical decision, decompose only into decision-changing sub-questions, and avoid building the report around tool calls or source lists. If research frame tools are disabled or unavailable, fall back to doing the same structure mentally and continue.
2. For guideline-answerable clinical recommendation questions, use a direct local hit before MCP. If no direct local hit exists, use `guideline_mcp_search` followed by `guideline_mcp_read` for the directly supporting context; `guideline_mcp_retrieve` is temporarily disabled. In expert mode, add evidence after 1-2 traceable passages directly answer a sub-question, then stop expanding unless there is conflict, missing context, old guidance, or a fast-moving topic.
3. Use `pubmed_search` as targeted freshness correction or primary-study retrieval, not as default broad exploration after MCP/local-library hits have already answered the claim. Before `pubmed_search`, try `source_library_search` with compact English title/PMID/topic terms; if a relevant local PubMed/PMC-like hit exists, use `web_read` on its `source_url` instead of searching PubMed again. Search PubMed only for the specific claim that could change the conclusion, such as a recent RCT, systematic review, safety signal, guideline update, or named study. Each complete PubMed abstract is archived separately and automatically upserted into the local source library; pass its returned `source_id` with a minimal continuous verbatim passage from the `Abstract` section and provenance `primary_abstract` for claims explicitly stated there. The `sources/search/` snapshot is discovery only, not evidence. If a PubMed query returns no PMID, do not keep rephrasing the same long comparison. Retry once with a shorter structurally different query: PMID/DOI if known; exact title phrase if known; first author plus distinctive title words; or disease + intervention + study type. Then pivot.
4. Use `pubmed_similar` only when one relevant PMID should seed retrieval expansion; review the top similar titles/abstract previews, then use `pubmed_read` or the returned abstract source paths only when they are decision-relevant.
5. Use `pubmed_read` only for selected records whose full text could change the decision; it reports whether PMC full text was obtained.
6. Search/read outputs are already archived before exposure.
7. Add tightly bounded evidence records when an abstract, full-text passage, or traceable MCP RAG chunk becomes decision-relevant; for a read_id, use copied text boundaries unless the directly read passage is no more than 12 source lines, in which case the matching range is sufficient. It is also acceptable to batch several `evidence_add` calls after reading if their source paths, read IDs or line ranges, and text boundaries are still available. After adding evidence, update the frame only when it changes a claim, source authority judgment, applicability boundary, next action, or stop condition; use `research_frame_scratchpad_append` for short observation → belief → next-action notes when useful. Use `low`/`moderate` confidence for early or indirect evidence and revise the final synthesis by weighing the evidence inventory. Avoid duplicate records for overlapping windows from the same source unless they support genuinely different claims.
8. Do not call `evidence_read` immediately after a successful `evidence_add` merely to verify it; `report_write` mechanically verifies referenced evidence. Use `evidence_list` for the evidence inventory and call `evidence_read` only when the exact quote/details are needed for writing or resolving conflict.
9. Treat full-document inspection as a bounded reasoning choice, not a mechanical quota. Read more when the model judges that context, conflict, harm, or applicability could change the decision; otherwise register sufficient evidence and write the report. Do not reread a source merely to satisfy an anchor or formatting rule.
10. Before stopping retrieval, check whether at least one source directly matches the population, intervention, comparator, and outcome requested. If not, state that the direct comparison is insufficient; do not let a larger body of indirect evidence silently replace it.
11. Before `report_write`, create an internal citation map from evidence IDs to numbered real references. In the report body and reference list, cite as `[1]`, `[2]` with real source text; pass the raw evidence IDs only through `report_write.references`.
12. Verify all claims before final answer.

### 附：五个步骤的循证示范（社区获得性肺炎）

急诊科某患者，男，65岁，既往健康，主诉咳嗽、黄色痰、气短、发烧、缺氧，未吸氧时氧饱和度为86%，右下肺可闻支气管呼吸音，白细胞计数升高，胸片示实变，入住普通内科，诊断为社区获得性肺炎，并被安排做相关检查。值班住院医生已使用抗生素，但犹豫是否应该合用皮质类固醇。

## 第一步 将临床问题转换为科学问题

科学问题包括4要素：患者、干预措施、比较措施和干预结果，简称PICO。
对于社区获得性肺炎患者(P)，抗生素(I)合用皮质类固醇治疗(I)能否降低死亡风险(O)，进入重症监护室(ICU)的风险(O)和插管治疗的风险(O)？

## 第二步 检索证据

## 1. 用于临床决策的数据库

"6S"证据金字塔（从顶到底）：证据组织、综合证据、系统评价摘要及评论、系统评价、原始研究摘要及评论、原始研究。
对应数据库：
证据组织：ZynxCare, ProVation MD
综合证据：UpToDate, Best Practice, G-I-N/NGC
系统评价摘要及评论：ACP Journal Club
● 系统评价：CDSR, PubMed
原始研究摘要及评论：ACP Journal Club
原始研究：CENTRAL, PubMed
其他：TRIP, Clinical Queries

## 2. 检索策略

由于当时的指南没有提及合用皮质类固醇治疗社区获得性肺炎，所以作者首先检索系统评价。作者检索PubMed的Clinical queries，使用术语Corticosteroids, Pneumonia和Adults。

## 3. 筛选结果

通过阅读标题、摘要和全文筛选，发现Ann Intern Med. 2015发表的一篇文章符合要求：
Siemieniuk RA, Meade MO, Alonso-Coello P, et al. Corticosteroid Therapy for Patients Hospitalized With Community-Acquired Pneumonia: A Systematic Review and Metaanalysis. Ann Intern Med. 2015;163(7):519-528. doi:10.7326/M15-0715

第三步 评价证据

## 基本内容： 一、证据的真实性 二、证据的重要性 三、证据的适用性

## 一、证据的真实性

## 1. 该系统评价纳入的是否为随机对照试验？

RESULTS: We included a total of 13 randomized, controlled trials (2005 patients), with 9 studies not included in the previous review.

## 2. 该系统评价是否全面系统检索了有关文献？

METHODS Data Sources and Searches: A previous Cochrane review with similar inclusion criteria identified studies up to December 2010 (13). Using the Medical Subject Headings terms "pneumonia" and "corticosteroid", we replicated the search strategy of that review (13) for MEDLINE, EMBASE, and the Cochrane Central Register of Controlled Trials (13) from 1 January 2010 to 24 May 2015. We manually searched the reference lists of included studies and existing systematic reviews as well as all articles citing the included studies on Google Scholar.

## 3. 该系统评价是否对每个研究的真实性进行了评估？

Two teams of 2 reviewers independently screened titles and abstracts in duplicate, obtained full texts of articles that either reviewer considered potentially eligible, and determined eligibility from the full texts.

Two reviewers independently extracted data and assessed risk of bias. For all phases of the project, reviewers resolved disagreements by discussion and, as necessary, in consultation with a third reviewer.

We used the Grading of Recommendations Assessment, Development, and Evaluation (GRADE) system to assess the certainty of evidence (also known as quality of evidence or confidence in evidence) for each outcome and for the entire body of evidence (18). Certainty of evidence takes into consideration the study design (in this case, randomized clinical trials); risk of bias, precision, consistency, and directness of the evidence; and the possibility of publication bias. A modified Cochrane instrument (19) provided the structure for assessing the risk of bias of the primary studies.

## 4. 该系统评价采用个体患者数据或汇总数据分析？

采用个体患者数据制作的系统评价结论比用汇总数据制作系统评价的结论更可靠。该系统评价收集的是随机对照试验，故属于汇总数据分析。

## 二、证据的重要性

## 1. 每个独立研究的结果是否一致？

合用皮质类固醇组5.3%的患者死亡，单纯用抗生素组7.9%的患者死亡。

## 2. 治疗效果有多大？

重症患者的绝对危险度减少率（ARR）为：-0.15（95%CI：-0.22，-0.08），即每治疗100例，减少死亡15例。
轻症患者ARR为：0.00（95%CI：-0.02，0.02）
全部患者ARR为：0.03（95%CI：-0.05，-0.01）
用需要治疗的人数（NNT）表示，重症患者的NNT=1/|-0.15|=6.7(4.6,12.5)，即平均每治67个患者，可救活10个。
进入ICU的风险和插管治疗的风险，合用抗生素和皮质类固醇治疗组也有更好的效果。

## 三、证据的适用性

## 2. 在该环境中治疗可行吗？

抗生素合用皮质类固醇在一般医院均可行。

## 3. 该患者获得的潜在利和弊是什么？

对于该患者，利是减少死亡的风险、进入ICU的风险和插管治疗的风险，弊是长期使用皮质类固醇有副作用，如胃溃疡、高血压和糖尿病等。很明显，抗生素合用皮质类固醇对该患者利大于弊。

## 4. 该患者的价值观和期望是什么？

临床医生应根据所获得的证据、自己的经验，并征求患者的意见制定科学的临床决策。

## 第四步 应用证据

通过上述严格评价，可以认为该系统评价提供的证据是真实的、有重要临床意义，并且适用于该患者，故可制定相应的治疗方案。

## 第五步：后效评价

1. 用循证医学的原则对前面4个步骤进行分析，找出成功经验和失败教训，以改善下一次的诊治水平。
2. 经过治疗，疗效如何，有何不良反应？患者和家属对治疗有何评价等。