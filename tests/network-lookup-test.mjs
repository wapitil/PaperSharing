const targets = [
  {
    name: "VICReg OpenAlex DOI",
    url: "https://api.openalex.org/works/https://doi.org/10.48550%2FarXiv.2105.04906",
    expectedStatus: 200,
    expectedText: "VICReg",
  },
  {
    name: "VICReg arXiv fallback",
    url: "https://export.arxiv.org/api/query?id_list=2105.04906",
    expectedStatus: 200,
    expectedText: "VICReg",
  },
  {
    name: "Attention arXiv fallback",
    url: "https://export.arxiv.org/api/query?id_list=1706.03762",
    expectedStatus: 200,
    expectedText: "Attention Is All You Need",
  },
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

for (const target of targets) {
  const response = await fetch(target.url);
  const text = await response.text();

  assert(
    response.status === target.expectedStatus,
    `${target.name} 返回 ${response.status}，预期 ${target.expectedStatus}`,
  );
  assert(text.includes(target.expectedText), `${target.name} 返回内容缺少：${target.expectedText}`);
}

console.log("network lookup test passed");
