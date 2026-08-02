type BlogForQuality = {
  title: string;
  slug: string;
  content: string;
  excerpt: string | null;
  featuredImage?: { width: number | null; height: number | null; size: number; publicUrl: string } | null;
  seo?: {
    metaTitle: string;
    metaDescription: string;
    keywords: unknown;
    schema: unknown;
  } | null;
};

type Check = {
  label: string;
  score: number;
  maxScore: 10;
  notes: string[];
};

const requiredSections = [
  "What is",
  "Why it matters",
  "Key Features",
  "Benefits",
  "How it Works",
  "Real World Use Cases",
  "Pros and Cons",
  "Best Practices",
  "Common Mistakes",
  "FAQs",
  "Conclusion",
  "Call To Action",
];

function clamp(score: number) {
  return Math.max(0, Math.min(10, Math.round(score)));
}

function words(content: string) {
  return content.split(/\s+/).filter(Boolean);
}

function headings(content: string, prefix: string) {
  return content.split("\n").filter((line) => line.startsWith(prefix));
}

function keywordList(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function hasDuplicateParagraphs(content: string) {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim().toLowerCase())
    .filter((paragraph) => paragraph.length > 80);
  return new Set(paragraphs).size < paragraphs.length;
}

function recommendation(score: number) {
  if (score >= 95) return "Excellent - Auto Publish";
  if (score >= 90) return "Passed - Ready to Publish";
  if (score >= 80) return "Good - Needs Minor Improvements";
  if (score >= 70) return "Review Required - Manual Review";
  return "Failed - Regenerate Article";
}

export function scoreBlogQuality(blog: BlogForQuality) {
  const content = blog.content;
  const wordList = words(content);
  const wordCount = wordList.length;
  const h1 = headings(content, "# ");
  const h2 = headings(content, "## ").map((line) => line.replace(/^##\s+/, ""));
  const h3 = headings(content, "### ");
  const keywords = keywordList(blog.seo?.keywords);
  const lowerContent = content.toLowerCase();
  const missingSections = requiredSections.filter(
    (section) => !h2.some((heading) => heading.toLowerCase().startsWith(section.toLowerCase()))
  );
  const paragraphs = content.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const longParagraphs = paragraphs.filter((paragraph) => paragraph.split(/\s+/).length > 130);
  const sentences = content.split(/[.!?]+/).map((sentence) => sentence.trim()).filter(Boolean);
  const averageSentenceWords = sentences.length
    ? sentences.reduce((sum, sentence) => sum + sentence.split(/\s+/).filter(Boolean).length, 0) / sentences.length
    : 0;

  const checks: Check[] = [
    {
      label: "SEO Structure",
      score: clamp(
        (h1.length === 1 ? 2 : 0) +
          (h2.length >= 10 ? 2 : 0) +
          (h3.length >= 8 ? 1 : 0) +
          (blog.seo?.metaTitle ? 1 : 0) +
          (blog.seo?.metaDescription ? 1 : 0) +
          (blog.slug ? 1 : 0) +
          (keywords.some((keyword) => lowerContent.includes(keyword.toLowerCase())) ? 2 : 0)
      ),
      maxScore: 10,
      notes: [`H1 count: ${h1.length}`, `H2 count: ${h2.length}`, `Keyword count: ${keywords.length}`],
    },
    {
      label: "Content Completeness",
      score: clamp(10 - missingSections.length * 0.8),
      maxScore: 10,
      notes: missingSections.length ? [`Missing: ${missingSections.join(", ")}`] : ["All required sections covered"],
    },
    {
      label: "Readability",
      score: clamp(10 - longParagraphs.length - Math.max(0, averageSentenceWords - 24) / 3),
      maxScore: 10,
      notes: [`Average sentence length: ${averageSentenceWords.toFixed(1)} words`, `Long paragraphs: ${longParagraphs.length}`],
    },
    {
      label: "Content Quality",
      score: clamp((wordCount >= 1200 ? 3 : 0) + (wordCount >= 1800 ? 2 : 0) + (h2.length >= 10 ? 2 : 0) + (!hasDuplicateParagraphs(content) ? 3 : 0)),
      maxScore: 10,
      notes: [`Word count: ${wordCount}`, hasDuplicateParagraphs(content) ? "Duplicate paragraph risk found" : "No duplicate paragraphs found"],
    },
    {
      label: "Keyword Optimization",
      score: clamp(keywords.reduce((sum, keyword) => sum + (lowerContent.includes(keyword.toLowerCase()) ? 1.5 : 0), 0)),
      maxScore: 10,
      notes: [`Keywords checked: ${keywords.length}`],
    },
    {
      label: "Technical SEO",
      score: clamp((blog.seo?.schema ? 2 : 0) + (blog.featuredImage ? 2 : 0) + (/\]\(https?:\/\//.test(content) ? 2 : 0) + (blog.seo?.metaTitle ? 2 : 0) + (blog.seo?.metaDescription ? 2 : 0)),
      maxScore: 10,
      notes: [blog.featuredImage ? "Featured image ready" : "Missing featured image", /\]\(https?:\/\//.test(content) ? "External links found" : "No external links found"],
    },
    {
      label: "Formatting & UX",
      score: clamp((/\|.+\|/.test(content) ? 2 : 0) + (/^- /m.test(content) ? 2 : 0) + (/^\d+\. /m.test(content) ? 2 : 0) + (/```/.test(content) ? 2 : 0) + (/table of contents/i.test(content) ? 2 : 0)),
      maxScore: 10,
      notes: ["Checked table, lists, code blocks, and table of contents"],
    },
    {
      label: "Media Quality",
      score: clamp(blog.featuredImage ? (blog.featuredImage.width && blog.featuredImage.width >= 1200 ? 5 : 3) + (blog.featuredImage.publicUrl ? 3 : 0) + (blog.featuredImage.size < 500_000 ? 2 : 1) : 0),
      maxScore: 10,
      notes: blog.featuredImage ? [`Image: ${blog.featuredImage.width ?? "-"}x${blog.featuredImage.height ?? "-"}`] : ["Missing featured image"],
    },
    {
      label: "AI & Fact Quality",
      score: clamp((!/(as an ai|i cannot|i don't have access)/i.test(content) ? 4 : 0) + (!hasDuplicateParagraphs(content) ? 3 : 0) + (!/(placeholder|todo|lorem ipsum)/i.test(content) ? 3 : 0)),
      maxScore: 10,
      notes: ["Checked AI disclaimers, duplicate paragraphs, and placeholders"],
    },
    {
      label: "Publishing Readiness",
      score: clamp((wordCount >= 1200 ? 3 : 0) + (h1.length === 1 ? 2 : 0) + (missingSections.length === 0 ? 2 : 0) + (!/(todo|placeholder|draft unavailable)/i.test(content) ? 2 : 0) + (blog.excerpt ? 1 : 0)),
      maxScore: 10,
      notes: [`Word count: ${wordCount}`, missingSections.length ? "Required sections missing" : "Required sections ready"],
    },
  ];

  const overallScore = checks.reduce((sum, check) => sum + check.score, 0);

  return {
    overallScore,
    passed: overallScore >= 90,
    recommendation: recommendation(overallScore),
    checks,
    scores: {
      seoStructure: checks[0].score,
      contentCompleteness: checks[1].score,
      readability: checks[2].score,
      contentQuality: checks[3].score,
      keywordOptimization: checks[4].score,
      technicalSeo: checks[5].score,
      formattingUx: checks[6].score,
      mediaQuality: checks[7].score,
      aiFactQuality: checks[8].score,
      publishingReadiness: checks[9].score,
    },
  };
}
