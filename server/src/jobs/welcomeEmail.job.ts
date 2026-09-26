import { env } from '../config/env'

export interface WelcomeEmailData {
  userId: string
  email: string
  name: string
}

type Log = (message: string) => void

function renderWelcomeEmail({ name }: WelcomeEmailData) {
  return {
    subject: `Welcome to saas-mvp, ${name}!`,
    body: [
      `Hi ${name},`,
      '',
      'Thanks for signing up. To get started, create an organization and invite your teammates:',
      `${env.CLIENT_URL}/`,
      '',
      '— The saas-mvp team',
    ].join('\n'),
  }
}

// Email delivery is intentionally stubbed: no provider is configured for this project.
// Real delivery plugs in right here — e.g. `await resend.emails.send({ to, subject, text })`
// with Resend or SendGrid. Everything around it (queueing, async processing) is already real.
export async function sendWelcomeEmail(data: WelcomeEmailData, log: Log) {
  const { subject, body } = renderWelcomeEmail(data)

  log(`would send welcome email to ${data.email} (user ${data.userId})`)
  log(`  subject: ${subject}`)
  for (const line of body.split('\n')) log(`  | ${line}`)

  return { delivered: false, to: data.email }
}
