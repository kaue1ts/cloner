const fs = require('fs');
const path = require('path');
const { ChannelType, OverwriteType } = require('discord.js');

/**
 * Validates and gets the correct Authorization header format.
 * Checks if the token is valid as a Bot token first, otherwise assumes User token.
 * @param {string} token
 * @returns {Promise<string>}
 */
async function getAuthHeader(token) {
  const cleanToken = token.trim();
  try {
    const testToken = cleanToken.startsWith('Bot ') ? cleanToken : `Bot ${cleanToken}`;
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { 'Authorization': testToken }
    });
    if (res.ok) {
      return testToken;
    }
  } catch (e) {
    // Ignore error
  }
  return cleanToken;
}

async function discordRequest(endpoint, method, body, authHeader) {
  const headers = {
    'Authorization': authHeader,
    'Content-Type': 'application/json'
  };

  const options = {
    method,
    headers
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    attempts++;
    const response = await fetch(`https://discord.com/api/v10${endpoint}`, options);

    if (response.status === 429) {
      const data = await response.json().catch(() => ({}));
      const retryAfter = (data.retry_after !== undefined ? data.retry_after : 1) * 1000;
      console.warn(`[Rate Limit] 429 recebido em ${method} ${endpoint}. Aguardando ${retryAfter}ms para tentar novamente (Tentativa ${attempts}/${maxAttempts})...`);
      await new Promise(resolve => setTimeout(resolve, retryAfter + 100));
      continue;
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Discord API Error on ${method} ${endpoint}: ${response.status} ${response.statusText} - ${errText}`);
    }

    if (response.status === 204) {
      return null;
    }
    return response.json();
  }

  throw new Error(`Excedeu o número máximo de tentativas de requisição na API do Discord para ${method} ${endpoint}`);
}

/**
 * Fetches all source guild details via REST API.
 * @param {string} sourceGuildId
 * @param {string} authHeader
 * @returns {Promise<object>}
 */
async function fetchSourceGuildData(sourceGuildId, authHeader) {
  const guildData = await discordRequest(`/guilds/${sourceGuildId}`, 'GET', null, authHeader);
  const channelsData = await discordRequest(`/guilds/${sourceGuildId}/channels`, 'GET', null, authHeader);
  const rolesData = await discordRequest(`/guilds/${sourceGuildId}/roles`, 'GET', null, authHeader);

  return { guildData, channelsData, rolesData };
}

/**
 * Clones the entire source server to the target server.
 * @param {string} sourceGuildId
 * @param {string} targetGuildId
 * @param {string} token
 * @param {import('discord.js').Client} client
 * @param {string} logChannelId
 * @returns {Promise<object>}
 */
async function cloneServer(sourceGuildId, targetGuildId, token, client, logChannelId) {
  const authHeader = await getAuthHeader(token);

  // Validate destination guild access via User Token first (to ensure user has access)
  let targetGuildData;
  try {
    targetGuildData = await discordRequest(`/guilds/${targetGuildId}`, 'GET', null, authHeader);
  } catch (err) {
    // If user token fails, check if the bot has access
    const botGuild = client.guilds.cache.get(targetGuildId) || await client.guilds.fetch(targetGuildId).catch(() => null);
    if (!botGuild) {
      throw new Error('Não foi possível acessar o servidor de destino. Verifique se o ID está correto e se você/o bot possui acesso a ele.');
    }
    targetGuildData = {
      id: botGuild.id,
      name: botGuild.name,
      icon: botGuild.icon
    };
  }

  // Fetch source server data
  const { guildData, channelsData, rolesData } = await fetchSourceGuildData(sourceGuildId, authHeader);

  // 1. Update target guild appearance (Name & Icon)
  try {
    let iconBase64 = null;
    if (guildData.icon) {
      const iconUrl = `https://cdn.discordapp.com/icons/${sourceGuildId}/${guildData.icon}.png`;
      const res = await fetch(iconUrl);
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        iconBase64 = `data:image/png;base64,${buffer.toString('base64')}`;
      }
    }

    await discordRequest(`/guilds/${targetGuildId}`, 'PATCH', {
      name: 'Clonado By Cloner 11k',
      icon: iconBase64
    }, authHeader);
  } catch (err) {
    console.error('Erro ao atualizar nome/ícone do servidor via REST:', err.message);
  }

  // 2. Fetch and delete existing target roles
  try {
    const targetRoles = await discordRequest(`/guilds/${targetGuildId}/roles`, 'GET', null, authHeader);
    for (const role of targetRoles) {
      if (role.id !== targetGuildId && !role.managed) {
        // Skip roles that are higher than the bot/user role if we get a permission error, but try to delete
        await discordRequest(`/guilds/${targetGuildId}/roles/${role.id}`, 'DELETE', null, authHeader)
          .catch((e) => console.error(`Erro ao deletar cargo via REST: ${e.message}`));
      }
    }
  } catch (err) {
    console.error('Erro ao buscar/deletar cargos:', err.message);
  }

  const roleMap = {}; // oldRoleId -> newRoleId
  roleMap[sourceGuildId] = targetGuildId; // Map @everyone role

  // Sort source roles by position to keep hierarchy
  const sortedSourceRoles = rolesData
    .filter((r) => r.id !== sourceGuildId && !r.managed)
    .sort((a, b) => a.position - b.position);

  for (const sourceRole of sortedSourceRoles) {
    try {
      const newRole = await discordRequest(`/guilds/${targetGuildId}/roles`, 'POST', {
        name: sourceRole.name,
        color: sourceRole.color,
        hoist: sourceRole.hoist,
        permissions: String(sourceRole.permissions),
        mentionable: sourceRole.mentionable
      }, authHeader);

      roleMap[sourceRole.id] = newRole.id;
    } catch (err) {
      console.error(`Erro ao criar cargo ${sourceRole.name} via REST:`, err.message);
    }
  }

  // Reorder created roles to preserve original hierarchy
  const reorderPayload = [];
  for (const sourceRole of sortedSourceRoles) {
    const targetRoleId = roleMap[sourceRole.id];
    if (targetRoleId) {
      reorderPayload.push({
        id: targetRoleId,
        position: sourceRole.position
      });
    }
  }

  if (reorderPayload.length > 0) {
    try {
      await discordRequest(`/guilds/${targetGuildId}/roles`, 'PATCH', reorderPayload, authHeader);
    } catch (err) {
      console.error('Erro ao reordenar cargos via REST:', err.message);
    }
  }

  // 3. Fetch and delete existing target channels
  try {
    const targetChannels = await discordRequest(`/guilds/${targetGuildId}/channels`, 'GET', null, authHeader);
    for (const channel of targetChannels) {
      if (channel.id === logChannelId) {
        continue;
      }
      await discordRequest(`/channels/${channel.id}`, 'DELETE', null, authHeader)
        .catch((e) => console.error(`Erro ao deletar canal via REST: ${e.message}`));
    }
  } catch (err) {
    console.error('Erro ao buscar/deletar canais:', err.message);
  }

  const channelMap = {}; // oldChannelId -> newChannelId

  // Create categories first
  const categories = channelsData.filter((c) => c.type === 4).sort((a, b) => a.position - b.position);
  for (const cat of categories) {
    try {
      const newCat = await discordRequest(`/guilds/${targetGuildId}/channels`, 'POST', {
        name: cat.name,
        type: 4,
        position: cat.position
      }, authHeader);
      channelMap[cat.id] = newCat.id;
    } catch (err) {
      console.error(`Erro ao criar categoria ${cat.name} via REST:`, err.message);
    }
  }

  // Create all other channels
  const regularChannels = channelsData.filter((c) => c.type !== 4).sort((a, b) => a.position - b.position);
  for (const chan of regularChannels) {
    try {
      const parentId = chan.parent_id ? channelMap[chan.parent_id] : null;

      // Map permission overwrites
      const permissionOverwrites = [];
      if (chan.permission_overwrites) {
        for (const overwrite of chan.permission_overwrites) {
          const mappedId = roleMap[overwrite.id];
          if (mappedId) {
            permissionOverwrites.push({
              id: mappedId,
              type: overwrite.type,
              allow: String(overwrite.allow),
              deny: String(overwrite.deny)
            });
          } else if (overwrite.id === sourceGuildId) {
            permissionOverwrites.push({
              id: targetGuildId,
              type: overwrite.type,
              allow: String(overwrite.allow),
              deny: String(overwrite.deny)
            });
          } else if (overwrite.type === 1) {
            // Member override, ID is global
            permissionOverwrites.push({
              id: overwrite.id,
              type: 1,
              allow: String(overwrite.allow),
              deny: String(overwrite.deny)
            });
          }
        }
      }

      const channelBody = {
        name: chan.name,
        type: chan.type,
        topic: chan.topic || null,
        nsfw: chan.nsfw || false,
        rate_limit_per_user: chan.rate_limit_per_user || 0,
        user_limit: chan.user_limit || 0,
        parent_id: parentId,
        permission_overwrites: permissionOverwrites,
        position: chan.position
      };

      if (chan.bitrate) {
        channelBody.bitrate = Math.min(Math.max(chan.bitrate, 8000), 96000);
      }

      const newChan = await discordRequest(`/guilds/${targetGuildId}/channels`, 'POST', channelBody, authHeader);
      channelMap[chan.id] = newChan.id;
    } catch (err) {
      console.error(`Erro ao criar canal ${chan.name} via REST:`, err.message);
    }
  }

  return {
    sourceGuildName: guildData.name,
    sourceGuildId: sourceGuildId,
    targetGuildName: 'Clonado By Cloner 11k',
    targetGuildId: targetGuildId
  };
}

module.exports = {
  cloneServer
};
