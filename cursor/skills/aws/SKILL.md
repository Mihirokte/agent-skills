---
name: aws
description: Uses the AWS CLI to access the account with EC2 permissions. Use when the user invokes /aws or asks to run AWS commands, manage EC2, list instances, or interact with their AWS account.
---

# AWS (CLI)

## When to use

Use this skill when the user says **/aws** or asks to run AWS commands, manage EC2 instances, or query their AWS account.

## How to run AWS

- **Always use the AWS CLI** (run `aws` in the terminal). Do not use boto3 or SDK in code unless the user explicitly asks for a script.
- **Always use the `ai-agent-admin` profile** so commands run with the dedicated AI agent role (EC2 permissions only).

### Profile

- **Profile name:** `ai-agent-admin`
- **Credentials:** Stored in `~/.aws/credentials` (Windows: `%USERPROFILE%\.aws\credentials`). Do not embed keys in prompts or code.

### Invocation

**Option A — env (preferred)**  
Set the profile for the current shell, then run `aws`:

```bash
$env:AWS_PROFILE="ai-agent-admin"   # PowerShell
# or
export AWS_PROFILE=ai-agent-admin   # Bash
aws ec2 describe-instances --region us-east-1
```

**Option B — flag**  
Pass the profile on every command:

```bash
aws ec2 describe-instances --profile ai-agent-admin --region us-east-1
```

Use **us-east-1** unless the user specifies another region.

## Common commands

- List instances: `aws ec2 describe-instances --profile ai-agent-admin --region us-east-1`
- Instance status: `aws ec2 describe-instance-status --profile ai-agent-admin --region us-east-1`
- Start/stop: `aws ec2 start-instances --instance-ids i-xxx --profile ai-agent-admin --region us-east-1` (and `stop-instances`)
- Output: add `--output table` or `--output json` as needed.

## Credentials: keys vs SSO

- **Access keys in `~/.aws/credentials`:** If you delete the `ai-agent-admin` access keys in the AWS Console, this profile stops working until you create new keys and update the credentials file.
- **To work without long-lived keys:** Use AWS IAM Identity Center (SSO). Create a permission set with the same EC2 policy, assign your user, then configure the profile for SSO (no `aws_access_key_id` / `aws_secret_access_key`). Run `aws sso login --profile ai-agent-admin` when needed; the CLI uses short-lived credentials. See [AWS CLI config for SSO](https://docs.aws.amazon.com/cli/latest/userguide/sso-configure-profile-token.html).

## Notes

- This user/role has **EC2 permissions only** (no S3, Lambda, IAM, etc.). If a command fails with access denied, the operation is not allowed for this profile.
- If the AWS CLI is not installed, tell the user to install it (e.g. `aws cli` installer or `pip install awscli`) and configure nothing else—the profile is already set up.
