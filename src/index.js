async function registerSlashCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('config')
      .setDescription('Abre o painel de configuração')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON()
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    // Força o registro de forma global para qualquer servidor
    await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: commands });
    console.log('Comandos globais registrados com sucesso.');
  } catch (error) {
    console.error('Não foi possível registrar os comandos:', error);
  }
}
