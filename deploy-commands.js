const { REST, Routes } = require('discord.js');
const { DISCORD_TOKEN, CLIENT_ID } = process.env;

const commands = [
  {
    name: 'play',
    description: 'Reproduce música desde YouTube o SoundCloud',
    options: [
      {
        name: 'query',
        description: 'Nombre o URL de la canción',
        type: 3,
        required: true
      }
    ]
  }
];

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registrando comandos...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Comandos registrados!');
    process.exit(0); // Asegura que el proceso termine después de ejecutar
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1); // Termina con código de error
  }
})();