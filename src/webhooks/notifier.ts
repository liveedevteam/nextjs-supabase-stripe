interface SlackConfig {
  webhookUrl: string
  channel?: string
}

export const notifySlack = async (
  config: SlackConfig,
  event: { id: string; type: string },
  error: unknown
) => {
  const message = {
    channel: config.channel,
    text: `🚨 *Stripe Webhook Failed*`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🚨 *Stripe Webhook Failed*\n*Event:* \`${event.type}\`\n*Event ID:* \`${event.id}\`\n*Error:* ${error instanceof Error ? error.message : String(error)}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `<!date^${Math.floor(Date.now() / 1000)}^{date_short_pretty} at {time}|${new Date().toISOString()}>`,
          },
        ],
      },
    ],
  }

  await fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  })
}
