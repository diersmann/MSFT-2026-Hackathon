# Deploy the dashboard to Azure App Service

The dashboard is a server-rendered Next.js application with API routes, so it
runs on a Linux Azure App Service rather than Azure Static Web Apps.

The workflow in `.github/workflows/deploy-dashboard.yml` builds a minimal
standalone bundle, configures its startup command, deploys it with GitHub OIDC,
and checks the resulting URL.

## 1. Azure Web App

Create a Web App with these settings:

- Publish: **Code**
- Runtime stack: **Node 24 LTS**
- Operating system: **Linux**
- App name: for example, `hackathon-ms-2026`
- App Service plan: Free is enough for a demo; Basic or higher avoids free-tier
  cold starts and supports Always On.

The workflow sets this startup command on every deployment:

```text
node packages/dashboard/server.js
```

## 2. GitHub OIDC

Create a Microsoft Entra application or user-assigned managed identity with a
federated credential for this repository's `main` branch. Its subject is:

```text
repo:OWNER/REPOSITORY:ref:refs/heads/main
```

Grant that identity permission to deploy and configure the Web App. Scoping the
role assignment to the Web App resource is preferable to subscription-wide
access.

Add these GitHub Actions secrets under **Settings → Secrets and variables →
Actions → Secrets**:

| Secret                  | Value                                                  |
| ----------------------- | ------------------------------------------------------ |
| `AZURE_CLIENT_ID`       | Client ID of the Entra application or managed identity |
| `AZURE_TENANT_ID`       | Microsoft Entra tenant ID                              |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID                                  |

Add these GitHub Actions variables under **Settings → Secrets and variables →
Actions → Variables**:

| Variable               | Value for the example app |
| ---------------------- | ------------------------- |
| `AZURE_WEBAPP_NAME`    | `hackathon-ms-2026`       |
| `AZURE_RESOURCE_GROUP` | `hackathon-ms-2026_group` |

Basic publishing authentication can remain disabled; the workflow uses OIDC.

## 3. App Service environment variables

These are runtime settings in Azure, not GitHub Actions secrets. Add them under
the Web App's **Settings → Environment variables** page.

Required for the board and GitHub writes:

| Setting                | Purpose                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| `GITHUB_TOKEN`         | Fine-grained PAT with Issues read/write and repository read access |
| `DISPATCH_TARGET_REPO` | Repository shown and modified by the dashboard, as `owner/repo`    |

Required when the dashboard uses Azure OpenAI for live rescoring:

| Setting                          | Value                                                               |
| -------------------------------- | ------------------------------------------------------------------- |
| `MODEL_PROVIDER`                 | `azure`                                                             |
| `AZURE_OPENAI_ENDPOINT`          | Bare resource endpoint, such as `https://RESOURCE.openai.azure.com` |
| `AZURE_OPENAI_API_KEY`           | Azure OpenAI resource key                                           |
| `AZURE_OPENAI_API_VERSION`       | `2024-10-21` unless the resource requires another supported version |
| `MODEL_SCORE`                    | Azure deployment name used for readiness scoring                    |
| `MODEL_DECOMPOSE`                | Azure deployment name used for issue decomposition                  |
| `MODEL_CLASSIFY`                 | Azure deployment name used for routing classification               |
| `DISPATCH_REASONING_DEPLOYMENTS` | Optional comma-separated reasoning deployment names                 |

The Actions-provided `GITHUB_TOKEN` exists only during the workflow. It cannot
be used by the running App Service, which is why a separate runtime credential
is required.

## 4. Protect the write endpoints

The dashboard exposes `/api/rescore` and `/api/reclassify`, and both can modify
the configured GitHub repository. Before sharing the URL publicly, enable Web
App **Settings → Authentication** with Microsoft Entra ID and require
authentication for all requests.

## 5. Deploy

Push the workflow and configuration to `main`, or run **Deploy dashboard to
Azure** manually from the GitHub Actions tab. A successful run publishes the
standalone application and performs an HTTP check against the deployed URL.
