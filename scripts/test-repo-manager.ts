#!/usr/bin/env npx tsx
/**
 * Test RepoManager - Clone, Branch, Push
 * 
 * Run: npx tsx scripts/test-repo-manager.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load .env from project root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  console.log('🔧 Testing RepoManager\n');
  
  const { RepoManager } = await import('../packages/worker/src/repo-manager.js');
  
  const repoManager = new RepoManager('/tmp/atomic-test');
  const jobId = `test-${Date.now()}`;
  const testRepoUrl = 'https://github.com/danvoulez/Atomic-Agents';
  
  try {
    // 1. Clone
    console.log('📥 Cloning repository...');
    const clone = await repoManager.clone(jobId, {
      url: testRepoUrl,
      branch: 'main',
    });
    console.log(`✅ Cloned to: ${clone.path}`);
    console.log(`   Branch: ${clone.branch}`);
    console.log(`   Commit: ${clone.commit.slice(0, 8)}`);
    
    // 2. Create branch
    console.log('\n🌿 Creating branch...');
    const branch = await repoManager.createBranch(clone.path, 'test-github-app', jobId);
    console.log(`✅ Branch: ${branch.name}`);
    console.log(`   Based on: ${branch.basedOn}`);
    console.log(`   Created: ${branch.created}`);
    
    // 3. Make a test change
    console.log('\n📝 Making test change...');
    const testFile = path.join(clone.path, '.github-app-test');
    fs.writeFileSync(testFile, `Test at ${new Date().toISOString()}\n`);
    console.log(`✅ Created file: .github-app-test`);
    
    // 4. Commit
    console.log('\n💾 Committing...');
    const commit = await repoManager.commit(clone.path, 'test: GitHub App integration test');
    console.log(`✅ Committed: ${commit.hash.slice(0, 8)}`);
    console.log(`   Files: ${commit.files}`);
    
    // 5. Push (optional - uncomment to actually push)
    console.log('\n🚀 Pushing to GitHub...');
    const push = await repoManager.push(clone.path, testRepoUrl);
    console.log(`✅ Pushed to: ${push.remote}`);
    console.log(`   Branch: ${push.branch}`);
    console.log(`   Commits: ${push.commits}`);
    
    // 6. Cleanup
    console.log('\n🧹 Cleaning up...');
    await repoManager.cleanup(clone.path);
    console.log('✅ Cleaned up');
    
    console.log('\n🎉 All RepoManager tests passed!\n');
    console.log('Check GitHub for the new branch:');
    console.log(`  https://github.com/danvoulez/Atomic-Agents/tree/${branch.name}`);
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    
    // Cleanup on error
    await repoManager.cleanupAll();
    
    process.exit(1);
  }
}

main();

