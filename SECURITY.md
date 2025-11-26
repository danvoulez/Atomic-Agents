# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please follow these steps:

### Do NOT

- Open a public GitHub issue
- Post about it on social media
- Disclose it publicly before it's fixed

### Do

1. **Email us** at security@your-domain.com (replace with your actual email)
2. **Include**:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Any suggested fixes

### What to Expect

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 1 week
- **Resolution Timeline**: Depends on severity
- **Credit**: We'll credit you in the release notes (unless you prefer anonymity)

## Security Best Practices

When deploying AI Coding Team:

### Environment Variables

```bash
# Never commit these to version control
DATABASE_URL=postgres://...
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

### Database

- Use strong passwords
- Enable SSL connections
- Restrict network access
- Regular backups

### API Access

- Implement authentication before production
- Use rate limiting (already built-in)
- Monitor for suspicious activity

### Agent Execution

- Always use budget limits
- Review escalations promptly
- Monitor tool usage patterns
- Keep append-only ledger enabled

## Known Security Considerations

### LLM Prompt Injection

The system includes defenses against prompt injection:
- Input validation
- Budget limits
- Tool restrictions
- Human escalation

However, no defense is perfect. Monitor agent behavior.

### File System Access

Agent tools can read/write files within the repository path:
- `repoPath` is validated
- Path traversal is blocked
- Consider running in containers

### Database Access

Agents have restricted database access:
- Read-only ledger queries
- Append-only writes
- No DELETE/UPDATE operations

## Security Updates

Watch the repository for security updates:
- Star/Watch the repo
- Check releases regularly
- Subscribe to security advisories

## Acknowledgments

We thank all security researchers who help keep AI Coding Team secure.

