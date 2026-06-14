/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("zeus_themes");
  if (!collection) return;

  // Evitar duplicados si ya existe el campo
  let fieldExists = false;
  collection.fields.forEach((f) => { if (f.name === "icon_lucide") fieldExists = true; });

  if (!fieldExists) {
    collection.fields.add(new Field({
      hidden: false,
      id: "bool_icon_lucide_01",
      name: "icon_lucide",
      presentable: false,
      required: false,
      system: false,
      type: "bool"
    }));
    return app.save(collection);
  }
}, (app) => {
  const collection = app.findCollectionByNameOrId("zeus_themes");
  if (!collection) return;

  let targetField = null;
  collection.fields.forEach((f) => { if (f.name === "icon_lucide") targetField = f; });

  if (targetField) {
    collection.fields.remove(targetField);
    return app.save(collection);
  }
})
