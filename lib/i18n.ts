// lib/i18n.ts

// Diccionario de traducciones
// Claves: categoría.subcategoría.clave (ej: common.welcome)
// Idiomas: es (español), fr (francés), de (alemán)

const translations: Record<string, Record<string, string>> = {
  'common.welcome': {
    es: 'Bienvenido a Zeus IA',
    fr: 'Bienvenue sur Zeus IA',
    de: 'Willkommen bei Zeus IA',
  },
  'common.loading': {
    es: 'Cargando...',
    fr: 'Chargement...',
    de: 'Laden...',
  },
  'common.error': {
    es: 'Error',
    fr: 'Erreur',
    de: 'Fehler',
  },
  'common.success': {
    es: 'Éxito',
    fr: 'Succès',
    de: 'Erfolg',
  },
  'common.save': {
    es: 'Guardar',
    fr: 'Enregistrer',
    de: 'Speichern',
  },
  'common.cancel': {
    es: 'Cancelar',
    fr: 'Annuler',
    de: 'Abbrechen',
  },
  'common.delete': {
    es: 'Eliminar',
    fr: 'Supprimer',
    de: 'Löschen',
  },
  'common.edit': {
    es: 'Editar',
    fr: 'Modifier',
    de: 'Bearbeiten',
  },
  'common.search': {
    es: 'Buscar',
    fr: 'Rechercher',
    de: 'Suchen',
  },
  'common.close': {
    es: 'Cerrar',
    fr: 'Fermer',
    de: 'Schließen',
  },
  'common.confirm': {
    es: 'Confirmar',
    fr: 'Confirmer',
    de: 'Bestätigen',
  },
  'common.back': {
    es: 'Atrás',
    fr: 'Retour',
    de: 'Zurück',
  },
  'common.next': {
    es: 'Siguiente',
    fr: 'Suivant',
    de: 'Weiter',
  },
  'common.submit': {
    es: 'Enviar',
    fr: 'Soumettre',
    de: 'Einreichen',
  },
  'common.retry': {
    es: 'Reintentar',
    fr: 'Réessayer',
    de: 'Erneut versuchen',
  },
  'menu.dashboard': {
    es: 'Panel de control',
    fr: 'Tableau de bord',
    de: 'Dashboard',
  },
  'menu.projects': {
    es: 'Proyectos',
    fr: 'Projets',
    de: 'Projekte',
  },
  'menu.settings': {
    es: 'Configuración',
    fr: 'Paramètres',
    de: 'Einstellungen',
  },
  'menu.help': {
    es: 'Ayuda',
    fr: 'Aide',
    de: 'Hilfe',
  },
  'menu.logout': {
    es: 'Cerrar sesión',
    fr: 'Déconnexion',
    de: 'Abmelden',
  },
  'auth.login': {
    es: 'Iniciar sesión',
    fr: 'Connexion',
    de: 'Anmelden',
  },
  'auth.register': {
    es: 'Registrarse',
    fr: 'S\'inscrire',
    de: 'Registrieren',
  },
  'auth.email': {
    es: 'Correo electrónico',
    fr: 'Email',
    de: 'E-Mail',
  },
  'auth.password': {
    es: 'Contraseña',
    fr: 'Mot de passe',
    de: 'Passwort',
  },
  'auth.forgot_password': {
    es: '¿Olvidaste tu contraseña?',
    fr: 'Mot de passe oublié?',
    de: 'Passwort vergessen?',
  },
  'project.create': {
    es: 'Crear proyecto',
    fr: 'Créer un projet',
    de: 'Projekt erstellen',
  },
  'project.name': {
    es: 'Nombre del proyecto',
    fr: 'Nom du projet',
    de: 'Projektname',
  },
  'project.description': {
    es: 'Descripción',
    fr: 'Description',
    de: 'Beschreibung',
  },
  'project.language': {
    es: 'Lenguaje',
    fr: 'Langage',
    de: 'Sprache',
  },
  'project.framework': {
    es: 'Framework',
    fr: 'Framework',
    de: 'Framework',
  },
  'project.platform': {
    es: 'Plataforma',
    fr: 'Plateforme',
    de: 'Plattform',
  },
  'file.upload': {
    es: 'Subir archivo',
    fr: 'Télécharger un fichier',
    de: 'Datei hochladen',
  },
  'file.download': {
    es: 'Descargar',
    fr: 'Télécharger',
    de: 'Herunterladen',
  },
  'file.delete': {
    es: 'Eliminar archivo',
    fr: 'Supprimer le fichier',
    de: 'Datei löschen',
  },
  'file.rename': {
    es: 'Renombrar',
    fr: 'Renommer',
    de: 'Umbenennen',
  },
  'folder.new': {
    es: 'Nueva carpeta',
    fr: 'Nouveau dossier',
    de: 'Neuer Ordner',
  },
  'folder.delete': {
    es: 'Eliminar carpeta',
    fr: 'Supprimer le dossier',
    de: 'Ordner löschen',
  },
  'code.generate': {
    es: 'Generar código',
    fr: 'Générer du code',
    de: 'Code generieren',
  },
  'code.run': {
    es: 'Ejecutar',
    fr: 'Exécuter',
    de: 'Ausführen',
  },
  'code.test': {
    es: 'Probar',
    fr: 'Tester',
    de: 'Testen',
  },
  'code.debug': {
    es: 'Depurar',
    fr: 'Déboguer',
    de: 'Debuggen',
  },
  'code.format': {
    es: 'Formatear',
    fr: 'Formater',
    de: 'Formatieren',
  },
  'ai.ask': {
    es: 'Preguntar a la IA',
    fr: 'Demander à l\'IA',
    de: 'KI fragen',
  },
  'ai.response': {
    es: 'Respuesta de la IA',
    fr: 'Réponse de l\'IA',
    de: 'KI-Antwort',
  },
  'ai.model': {
    es: 'Modelo',
    fr: 'Modèle',
    de: 'Modell',
  },
  'ai.temperature': {
    es: 'Temperatura',
    fr: 'Température',
    de: 'Temperatur',
  },
  'ai.max_tokens': {
    es: 'Máximo de tokens',
    fr: 'Nombre maximum de jetons',
    de: 'Maximale Tokenanzahl',
  },
  'history.undo': {
    es: 'Deshacer',
    fr: 'Annuler',
    de: 'Rückgängig',
  },
  'history.redo': {
    es: 'Rehacer',
    fr: 'Rétablir',
    de: 'Wiederherstellen',
  },
  'history.clear': {
    es: 'Limpiar historial',
    fr: 'Effacer l\'historique',
    de: 'Verlauf löschen',
  },
  'settings.language': {
    es: 'Idioma de la interfaz',
    fr: 'Langue de l\'interface',
    de: 'Oberflächensprache',
  },
  'settings.theme': {
    es: 'Tema',
    fr: 'Thème',
    de: 'Thema',
  },
  'settings.notifications': {
    es: 'Notificaciones',
    fr: 'Notifications',
    de: 'Benachrichtigungen',
  },
  'settings.privacy': {
    es: 'Privacidad',
    fr: 'Confidentialité',
    de: 'Datenschutz',
  },
  'error.generic': {
    es: 'Ha ocurrido un error inesperado',
    fr: 'Une erreur inattendue s\'est produite',
    de: 'Ein unerwarteter Fehler ist aufgetreten',
  },
  'error.network': {
    es: 'Error de conexión',
    fr: 'Erreur de connexion',
    de: 'Verbindungsfehler',
  },
  'error.not_found': {
    es: 'No encontrado',
    fr: 'Pas trouvé',
    de: 'Nicht gefunden',
  },
  'error.permission': {
    es: 'Permiso denegado',
    fr: 'Autorisation refusée',
    de: 'Berechtigung verweigert',
  },
  'success.saved': {
    es: 'Guardado correctamente',
    fr: 'Enregistré avec succès',
    de: 'Erfolgreich gespeichert',
  },
  'success.deleted': {
    es: 'Eliminado correctamente',
    fr: 'Supprimé avec succès',
    de: 'Erfolgreich gelöscht',
  },
  'success.created': {
    es: 'Creado correctamente',
    fr: 'Créé avec succès',
    de: 'Erfolgreich erstellt',
  },
  'confirm.delete_message': {
    es: '¿Estás seguro de que deseas eliminar este elemento?',
    fr: 'Êtes-vous sûr de vouloir supprimer cet élément?',
    de: 'Sind Sie sicher, dass Sie dieses Element löschen möchten?',
  },
  'confirm.unsaved_changes': {
    es: 'Tiene cambios sin guardar. ¿Desea continuar?',
    fr: 'Vous avez des modifications non enregistrées. Voulez-vous continuer?',
    de: 'Sie haben nicht gespeicherte Änderungen. Möchten Sie fortfahren?',
  },
};

// Idioma por defecto
const DEFAULT_LANG = 'es';

/**
 * Obtiene la traducción de una clave en el idioma especificado.
 * @param key - Clave de la traducción (ej. 'common.welcome')
 * @param lang - Código de idioma ('es', 'fr', 'de'). Por defecto 'es'.
 * @returns El texto traducido o la clave si no se encuentra.
 */
export function t(key: string, lang: string = DEFAULT_LANG): string {
  // Normalizar idioma a minúsculas
  const language = lang.toLowerCase();
  
  // Buscar la traducción
  const translation = translations[key];
  if (!translation) {
    // Si no existe la clave, devolver la clave como fallback
    console.warn(`Translation key not found: ${key}`);
    return key;
  }
  
  // Si el idioma solicitado existe, devolverlo
  if (translation[language]) {
    return translation[language];
  }
  
  // Si el idioma solicitado no está disponible, intentar con el idioma por defecto
  if (translation[DEFAULT_LANG]) {
    return translation[DEFAULT_LANG];
  }
  
  // Último recurso: devolver la primera traducción disponible
  const firstKey = Object.keys(translation)[0];
  if (firstKey) {
    return translation[firstKey];
  }
  
  // Si no hay ninguna traducción, devolver la clave
  return key;
}

/**
 * Exporta el objeto de traducciones para acceso directo si es necesario.
 */
export { translations };
