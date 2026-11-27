# HRMS Core

## Deploying with Portainer

Deploy this stack to a **Docker Standalone** environment. The Compose file builds
the frontend and backend images and expects an existing external Docker network.

1. In Portainer, open **Networks** for the target environment and create a
   `shared_network` bridge network. The stack refers to this network as external,
   so deployment will fail if it does not already exist.
2. Open **Stacks** > **Add stack**, select **Repository** (or **Web editor**),
   and provide this repository and its `docker-compose.yml`.
3. Add these stack environment variables before deploying:

   | Variable | Value |
   | --- | --- |
   | `DB_PASS` | A strong, unique PostgreSQL password |
   | `AUTH_SECRET` | A separate random secret of at least 32 bytes |
   | `ADMIN_PASSWORD` | Unique initial admin password, at least 12 characters |
   | `ADMIN_EMAIL` | Initial admin email; defaults to `admin@hrms.local` |
   | `ADMIN_NAME` | Initial admin display name; defaults to `HRMS Administrator` |
   | `FRONTEND_ORIGIN` | Exact browser-facing frontend origin, e.g. `https://hrms.example.com` |
   | `VITE_API_BASE_URL` | Browser-facing API base URL, e.g. `https://hrms-api.example.com/api/v1` |
   | `NODE_ENV` | `production` (the default) |

   Generate each secret independently. For example, run this locally and use a
   different generated value for `DB_PASS` and `AUTH_SECRET`:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Set a separate strong value for `ADMIN_PASSWORD` in Portainer. There is no
   shared default password in the repository. On first startup, the backend
   provisions the configured admin account and assigns it to the `admin` group.
   Sign in with `ADMIN_EMAIL` (or `admin@hrms.local` if not overridden) and the
   password configured in `ADMIN_PASSWORD`.
   The password is only used when creating that account; changing the variable
   later does not reset an existing account's password.

   `VITE_API_BASE_URL` is compiled into the frontend image and must be reachable
   by users' browsers; do not set it to an internal Docker hostname such as
   `http://backend:8000`. Configure HTTPS for both browser-facing URLs in
   production. The frontend and API should be on the same site so the browser
   sends the HTTP-only session cookie. The Compose file also publishes
   PostgreSQL and Adminer ports; restrict them with the host firewall or remove
   those port mappings if host access is not required. Do not expose them
   directly to the public internet.
4. Click **Deploy the stack**. The first deployment creates the PostgreSQL
   `hrms_pgdata` volume and the backend creates the account, group, and permission
   tables automatically.
   Check the backend container logs if it restarts while PostgreSQL is starting.
5. Open the frontend URL and create an account. For later code updates, pull the
   latest repository revision and redeploy the stack so Portainer rebuilds the
   images. Keep the existing `hrms_pgdata` volume and keep `DB_PASS` unchanged
   unless you also rotate the password in PostgreSQL. When upgrading an existing
   stack, set `DB_PASS` to the password already used by that database; changing
   this variable alone does not update a password in an existing data volume.
   The initial database password is only applied when its data volume is first
   created.

For local HTTP development, set `NODE_ENV=development` and use the local
browser-facing frontend and API URLs. Do not use that setting for a production
deployment.

## Self-service accounts

The portal supports email-and-password registration and sign-in. Passwords are
stored as scrypt hashes, and successful sign-ins use an HTTP-only session cookie.
New accounts can register from the sign-in page; passwords must be at least 12
characters long.

The backend requires PostgreSQL, `DB_PASS`, `FRONTEND_ORIGIN`, and an
`AUTH_SECRET` containing at least 32 bytes, plus an `ADMIN_PASSWORD` of at least
12 characters for default admin provisioning. For Docker Compose outside
Portainer, create a `.env` file in the repository root and set those variables
along with `VITE_API_BASE_URL` and `ADMIN_PASSWORD`. Do not reuse the database
password or authentication secret as the admin password.

Users self-register into the `employee` group. The provisioned admin account is
assigned to the `admin` group, which has access to all pages and user/group
administration. From the dashboard, admins can create groups, grant page or
administration permissions, and assign users to groups. The frontend checks
dashboard permission through the backend before rendering it. Protect
application data endpoints with the
corresponding `page.*` permission as those pages gain data APIs.

Generate `AUTH_SECRET` independently from the database and admin passwords, for
example:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The account system currently does not verify email addresses or provide password
recovery. Configure HTTPS in production so session cookies are marked Secure.
