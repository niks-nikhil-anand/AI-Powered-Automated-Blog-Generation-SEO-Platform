/**
 * One-shot cutover helper for the manual-blog-input refactor.
 *
 * The Prisma migration (prisma/migrations/20260918120000_manual_blog_input)
 * already does the destructive schema work - dropping Trend/ManualTopic/
 * ResearchRun and repointing every trendId column at BlogInput. This script
 * is the post-migration check and cleanup:
 *
 *   1. verify the BlogInput table actually exists (i.e. the migration ran),
 *   2. drop the research worker's audit rows, which now reference a worker
 *      that no longer exists,
 *   3. report what survived, so the cutover is visible rather than assumed.
 *
 * Run it with:  npx tsx scripts/migrate-to-manual-input.ts
 */
import { prisma } from "../workers/shared/prisma";

async function migrate() {
  console.log("Verifying the manual-blog-input cutover...\n");

  try {
    await prisma.blogInput.findMany({ take: 1 });
    console.log("✓ BlogInput table ready");
  } catch {
    console.error("✗ BlogInput table missing. Run: npx prisma migrate deploy");
    process.exit(1);
  }

  const { count: researchAttempts } = await prisma.workerAttempt.deleteMany({
    where: { worker: { in: ["research-worker", "research_worker"] } },
  });
  console.log(`✓ Removed ${researchAttempts} research-worker audit row(s)`);

  const [blogInputs, blogs, orphanBlogs, plans, outlines] = await Promise.all([
    prisma.blogInput.count(),
    prisma.blog.count(),
    prisma.blog.count({ where: { blogInputId: null } }),
    prisma.contentPlan.count(),
    prisma.contentOutline.count(),
  ]);

  console.log("\nCurrent state:");
  console.log(`  BlogInput rows:      ${blogInputs}`);
  console.log(`  Blog rows:           ${blogs} (${orphanBlogs} not linked to a submission)`);
  console.log(`  ContentPlan rows:    ${plans}`);
  console.log(`  ContentOutline rows: ${outlines}`);

  console.log("\nNext steps:");
  console.log("  1. Restart the workers:  npm run worker:dev");
  console.log("  2. Submit a blog at:     http://localhost:3000/dashboard/blogs/new");
  if (orphanBlogs > 0) {
    console.log(
      `\nNote: ${orphanBlogs} pre-cutover blog(s) have no submission behind them. They keep their content, SEO and quality reports; they just can't be regenerated through the new pipeline.`
    );
  }
}

migrate()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
