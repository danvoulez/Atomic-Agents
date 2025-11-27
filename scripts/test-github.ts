#!/usr/bin/env npx ts-node
/**
 * Test GitHub App Authentication
 * 
 * Run: npx ts-node scripts/test-github.ts
 * Or:  pnpm test:github
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from project root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  console.log('🔐 Testing GitHub App Authentication\n');
  
  // Check required env vars
  const required = [
    'GITHUB_APP_ID',
    'GITHUB_APP_PRIVATE_KEY',
    'GITHUB_APP_INSTALLATION_ID',
  ];
  
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error('❌ Missing environment variables:', missing.join(', '));
    process.exit(1);
  }
  
  console.log('✅ Environment variables found');
  console.log(`   App ID: ${process.env.GITHUB_APP_ID}`);
  console.log(`   Installation ID: ${process.env.GITHUB_APP_INSTALLATION_ID}`);
  console.log(`   Private Key: ${process.env.GITHUB_APP_PRIVATE_KEY?.slice(0, 50)}...`);
  
  // Dynamic import to handle ESM
  const { GitHubAppAuth } = await import('../packages/worker/src/github-auth.js');
  
  try {
    // Create auth instance
    const app = GitHubAppAuth.fromEnv();
    console.log('\n✅ GitHubAppAuth created successfully');
    
    // Generate JWT
    const jwt = app.getJWT();
    console.log(`✅ JWT generated: ${jwt.slice(0, 50)}...`);
    
    // List installations
    console.log('\n📋 Fetching installations...');
    const installations = await app.listInstallations();
    console.log(`✅ Found ${installations.length} installation(s):`);
    for (const inst of installations) {
      console.log(`   - ${inst.account.login} (ID: ${inst.id})`);
    }
    
    // Get installation token
    console.log('\n🔑 Getting installation access token...');
    const token = await app.getInstallationToken();
    console.log(`✅ Token obtained: ${token.token.slice(0, 20)}...`);
    console.log(`   Expires: ${token.expiresAt.toISOString()}`);
    console.log(`   Permissions: ${Object.keys(token.permissions).join(', ')}`);
    
    // Test git credentials
    console.log('\n🔗 Testing git credentials...');
    const creds = await app.getGitCredentials('danvoulez', 'Atomic-Agents');
    console.log(`✅ Git credentials ready`);
    console.log(`   Username: ${creds.username}`);
    console.log(`   Password: ${creds.password.slice(0, 20)}...`);
    
    // Test authenticated URL
    const testUrl = 'https://github.com/danvoulez/Atomic-Agents';
    const authUrl = creds.gitUrl(testUrl);
    console.log(`   Auth URL: ${authUrl.replace(creds.password, '***')}`);
    
    console.log('\n🎉 All tests passed! GitHub App is configured correctly.\n');
    console.log('Next steps:');
    console.log('  1. Run: pnpm build');
    console.log('  2. Start workers: pnpm start:worker');
    console.log('  3. Create a job to test clone/push');
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    
    if (error.message.includes('Bad credentials')) {
      console.error('\nPossible causes:');
      console.error('  - App ID is incorrect');
      console.error('  - Private key is corrupted or wrong format');
      console.error('  - Private key has wrong newline escaping');
    }
    
    if (error.message.includes('Not Found')) {
      console.error('\nPossible causes:');
      console.error('  - Installation ID is incorrect');
      console.error('  - App is not installed on the repository');
    }
    
    process.exit(1);
  }
}

main();

