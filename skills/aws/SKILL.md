---
name: aws
description: Uses the AWS CLI safely for account and infrastructure tasks. Use when the user invokes /aws or asks to inspect or manage AWS resources.
---

# AWS (CLI)

## When to use

Use this skill when the user says **/aws** or asks to run AWS commands, manage EC2 instances, or query their AWS account.

## How to run AWS

- **Always use the AWS CLI** (run `aws` in the terminal). Do not use boto3 or SDK in code unless the user explicitly asks for a script.
- Prefer the profile in `AWS_PROFILE`; otherwise ask which configured profile to use.
- Never assume a profile's permissions or mutate resources without the user's request.

### Profile

- **Credentials:** Use the AWS CLI credential chain, ideally IAM Identity Center (SSO) or another short-lived provider. Do not embed keys in prompts or code.

### Invocation

**Option A — env (preferred)**  
Set the profile for the current shell, then run `aws`:

```bash
$env:AWS_PROFILE="my-profile"       # PowerShell
# or
export AWS_PROFILE=my-profile       # Bash
aws sts get-caller-identity
```

**Option B — flag**  
Pass the profile on every command:

```bash
aws ec2 describe-instances --profile my-profile --region us-east-1
```

Use `AWS_REGION` / `AWS_DEFAULT_REGION` when configured. Otherwise ask before a region-specific operation.

## Common commands

- Identity check: `aws sts get-caller-identity`
- List instances: `aws ec2 describe-instances`
- Instance status: `aws ec2 describe-instance-status`
- Start/stop only when requested: `aws ec2 start-instances --instance-ids i-xxx` (and `stop-instances`)
- Output: add `--output table` or `--output json` as needed.

## Credentials: keys vs SSO

- Prefer AWS IAM Identity Center (SSO): run `aws configure sso`, then `aws sso login --profile <name>`.
- If static credentials are unavoidable, keep them outside repositories and rotate them regularly.

## Notes

- Start with read-only identity/status commands when account context is unclear.
- If the AWS CLI is missing, point to the official AWS CLI v2 installer.
