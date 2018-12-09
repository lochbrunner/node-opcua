"use strict";

/**
 * @module opcua.miscellaneous
 */

const assert = require("node-opcua-assert").assert;
const fs = require("fs");
const path = require("path");
const _ = require("underscore");

const getFactory = require("node-opcua-factory/src/factories_factories").getFactory;

const schema_helpers = require("node-opcua-factory/src/factories_schema_helpers");
const extract_all_fields = schema_helpers.extract_all_fields;
const resolve_schema_field_types = schema_helpers.resolve_schema_field_types;
const check_schema_correctness = schema_helpers.check_schema_correctness;
const coerceNodeId = require("node-opcua-nodeid").coerceNodeId;

const objectNodeIds = require("node-opcua-constants").ObjectIds;
const ec = require("node-opcua-basic-types");

const makeExpandedNodeId = require("node-opcua-nodeid/src/expanded_nodeid").makeExpandedNodeId;

const debugLog = require("node-opcua-debug").make_debugLog(__filename);
//xx var doDebug = require("node-opcua-debug").checkDebugFlag(__filename);

const utils = require("node-opcua-utils");
const normalize_require_file = utils.normalize_require_file;
const LineFile = require("node-opcua-utils").LineFile;

//xx exports.folder_for_generated_file = path.normalize(path.join(__dirname,"../../node-opcua/generated"));
//xx if (fs.existsSync && !fs.existsSync(exports.folder_for_generated_file)) {
//xx     fs.mkdirSync(exports.folder_for_generated_file);
//xx }

function get_class_javascript_filename(schema_name, optional_folder) {
    let folder;
    if (optional_folder) {
        if (!fs.existsSync(optional_folder)) {
            fs.mkdirSync(optional_folder);
            if (!fs.existsSync(optional_folder)) {
                throw new Error("get_class_javascript_filename: Cannot find folder " + optional_folder);
            }
        }
        folder = optional_folder;
        //xx assert(optional_folder === "tmp");
        //xx // folder = path.normalize(path.join(process.cwd(), optional_folder));
        //xx folder = path.normalize(path.join(__dirname,"../../..", optional_folder));
    } else {
        folder = exports.folder_for_generated_file;
        throw new Error("get_class_javascript_filename : DEPRECATED ");
    }
    return path.join(folder, "_auto_generated_" + schema_name + ".js");
}

exports.get_class_javascript_filename = get_class_javascript_filename;

function get_class_javascript_filename_local(schema_name) {
    let generate_source = getFactory(schema_name).prototype._schema.generate_source;
    if (!generate_source) {
        const folder = "."; // exports.folder_for_generated_file;
        generate_source = path.join(folder, "_auto_generated_" + schema_name + ".js");
    }
    return generate_source;
}

const RUNTIME_GENERATED_ID = +-1;

function write_enumeration_setter(f, schema, field, member, i) {
    assert(f instanceof LineFile);
    function write() {
        f.write.apply(f, arguments);
    }
    const className = schema.name;
    const capMember = utils.capitalizeFirstLetter(member);
    write(className + ".prototype.set" + capMember + " = function(value) {");
    write("   const coercedValue = _enumerations." + field.fieldType + ".typedEnum.get(value);");
    write("   /* istanbul ignore next */");
    write("   if (coercedValue === undefined || coercedValue === null) {");
    write('      throw new Error("value cannot be coerced to ' + field.fieldType + ': " + value);');
    write("   }");
    write("   this." + member + " = coercedValue;");
    write("};");
}
function write_enumeration(f, schema, field, member, i) {
    assert(f instanceof LineFile);
    function write() {
        f.write.apply(f, arguments);
    }

    //xx const __member = "$" + member;

    assert(!field.isArray); // would not work in this case

    const capMember = utils.capitalizeFirstLetter(member);
    write(
        "    self.set" + capMember + "(initialize_field(schema.fields[" + i + "]" + ", options." + field.name + "));"
    );
}

function write_complex_fast_construct(f, schema, field, member /*, i*/) {
    assert(f instanceof LineFile);
    function write() {
        f.write.apply(f, arguments);
    }
    if (field.isArray) {
        write("        self." + member + " =  null; /* null array */");
    } else {
        write("        self." + member + " =  null; /* new " + field.fieldType + "(null); */");
    }
}

function write_complex(f, schema, field, member /*, i*/) {
    assert(f instanceof LineFile);
    function write() {
        f.write.apply(f, arguments);
    }

    if (field.isArray) {
        if (field.hasOwnProperty("defaultValue")) {
            //todo: fix me => should call field defaultValue in the live version
            write("    self." + member + " = null;");
        } else {
            write("    self." + member + " = [];");
        }
        write("    if (options." + member + ") {");
        write("        assert(_.isArray(options." + member + "));");
        write(
            "        self." +
                member +
                " = options." +
                member +
                ".map(function(e){ return new " +
                field.fieldType +
                "(e); } );"
        );
        write("    }");
    } else {
        if (field.defaultValue === null || field.fieldType === schema.name) {
            write(
                "    self." +
                    member +
                    " = (options." +
                    member +
                    ") ? new " +
                    field.fieldType +
                    "( options." +
                    member +
                    ") : null;"
            );
        } else {
            write("    self." + member + " =  new " + field.fieldType + "( options." + member + ");");
        }
    }
}

function write_basic(f, schema, field, member, i) {
    assert(f instanceof LineFile);
    function write() {
        f.write.apply(f, arguments);
    }

    assert(field.category === "basic");

    if (field.isArray) {
        write(
            "    self." +
                member +
                " = initialize_field_array(schema.fields[" +
                i +
                "]" +
                ", options." +
                field.name +
                ");"
        );
    } else {
        write("    self." + member + " = initialize_field(schema.fields[" + i + "]" + ", options." + field.name + ");");
    }
}

/* eslint complexity:[0,50],  max-statements: [1, 254]*/
function produce_code(schema_file, schema_name, source_file) {
    let is_complex_type;
    let i, field, fieldType, member, __member;

    schema_file = schema_file.replace(/\\/g, "/");

    let full_path_to_schema;
    if (schema_file.match(/^\$node-opcua/)) {
        full_path_to_schema = path.resolve(path.join(__dirname, "../../../node_modules", schema_file));
    } else {
        full_path_to_schema = path.resolve(schema_file);
    }

    debugLog("\nfull_path_to_schema    ".red, full_path_to_schema);

    const relative_path_to_schema = normalize_require_file(__dirname, full_path_to_schema);
    debugLog("relative_path_to_schema".red, relative_path_to_schema);

    const local_schema_file = normalize_require_file(path.dirname(source_file), full_path_to_schema);
    debugLog("local_schema_file      ".red, local_schema_file);

    const schema = require(relative_path_to_schema)[schema_name];

    check_schema_correctness(schema);

    if (!schema) {
        throw new Error(" Cannot find schema " + schema_name + " in " + relative_path_to_schema);
    }
    const name = schema.name;

    // check the id of the object binary encoding
    let encoding_BinaryId = schema.id;
    let encoding_XmlId;
    if (encoding_BinaryId === undefined) {
        encoding_BinaryId = objectNodeIds[name + "_Encoding_DefaultBinary"];
        encoding_XmlId = objectNodeIds[name + "_Encoding_DefaultXml"];
    } else {
        //xx debugLog(schema_file,schema.name, id);
        //xx  assert(id === RUNTIME_GENERATED_ID);
    }
    if (!encoding_BinaryId) {
        throw new Error(
            "" + name + " has no _Encoding_DefaultBinary id\nplease add a Id field in the structure definition"
        );
    }
    if (typeof encoding_XmlId === "string") {
        encoding_XmlId = coerceNodeId(encoding_XmlId);
    }
    if (typeof encoding_BinaryId === "string") {
        encoding_BinaryId = coerceNodeId(encoding_BinaryId);
    }

    const encodingBinaryNodeId =
        encoding_BinaryId === RUNTIME_GENERATED_ID ? encoding_BinaryId : makeExpandedNodeId(encoding_BinaryId);
    const encodingXmlNodeId = encoding_XmlId ? makeExpandedNodeId(encoding_XmlId) : null;

    schema.baseType = schema.baseType || "BaseUAObject";

    const baseclass = schema.baseType;

    const classname = schema.name;

    const f = new LineFile();

    function write() {
        f.write.apply(f, arguments);
    }

    resolve_schema_field_types(schema);
    const complexTypes = schema.fields.filter(function(field) {
        return field.category === "complex" && field.fieldType !== schema.name;
    });

    const folder_for_source_file = path.dirname(source_file);

    // -------------------------------------------------------------------------
    // - insert common require's
    // -------------------------------------------------------------------------
    write('"use strict";');
    write("/**");
    write(" * @module opcua.address_space.types");
    write(" */");
    write('const assert = require("node-opcua-assert").assert;');
    write('const util = require("util");');
    write('const _  = require("underscore");');
    write('const makeNodeId = require("node-opcua-nodeid").makeNodeId;');
    write('const schema_helpers =  require("node-opcua-factory/src/factories_schema_helpers");');

    write("const extract_all_fields                       = schema_helpers.extract_all_fields;");
    write("const resolve_schema_field_types               = schema_helpers.resolve_schema_field_types;");
    write("const initialize_field                         = schema_helpers.initialize_field;");
    write("const initialize_field_array                   = schema_helpers.initialize_field_array;");
    write("const check_options_correctness_against_schema = schema_helpers.check_options_correctness_against_schema;");
    write('const _defaultTypeMap = require("node-opcua-factory/src/factories_builtin_types")._defaultTypeMap;');

    write('const ec = require("node-opcua-basic-types");');
    write("const encodeArray = ec.encodeArray;");
    write("const decodeArray = ec.decodeArray;");
    write('const makeExpandedNodeId = require("node-opcua-nodeid/src/expanded_nodeid").makeExpandedNodeId;');

    write('const generate_new_id = require("node-opcua-factory").generate_new_id;');
    write('const _enumerations = require("node-opcua-factory/src/factories_enumerations")._private._enumerations;');
    // -------------------------------------------------------------------------
    // - insert schema
    // -------------------------------------------------------------------------

    write('const schema = require("' + local_schema_file + '").' + classname + "_Schema;");

    // -------------------------------------------------------------------------
    // - insert definition of complex type used by this class
    // -------------------------------------------------------------------------

    write('const getFactory = require("node-opcua-factory/src/factories_factories").getFactory;');
    const tmp_map = {};
    complexTypes.forEach(function(field) {
        if (tmp_map.hasOwnProperty(field.fieldType)) {
            return;
        }
        tmp_map[field.fieldType] = 1;

        const filename = get_class_javascript_filename_local(field.fieldType);
        const local_filename = normalize_require_file(folder_for_source_file, filename);

        if (fs.existsSync(filename)) {
            write("const " + field.fieldType + ' = require("' + local_filename + '").' + field.fieldType + ";");
        } else {
            write("const " + field.fieldType + ' = getFactory("' + field.fieldType + '");');
        }
    });

    // -------------------------------------------------------------------------
    // - insert definition of base class
    // -------------------------------------------------------------------------
    write('const BaseUAObject = require("node-opcua-factory/src/factories_baseobject").BaseUAObject;');
    if (baseclass !== "BaseUAObject") {
        const filename = get_class_javascript_filename_local(baseclass);
        const local_filename = normalize_require_file(folder_for_source_file, filename);

        if (fs.existsSync(filename)) {
            write("const " + baseclass + ' = require("' + local_filename + '").' + baseclass + ";");
        } else {
            write("const " + baseclass + ' = getFactory("' + baseclass + '");');
        }
    }

    function makeFieldType(field) {
        return "{" + field.fieldType + (field.isArray ? "[" : "") + (field.isArray ? "]" : "") + "}";
    }

    // -------------------------------------------------------------------------
    // - insert class enumeration properties
    // -------------------------------------------------------------------------
    let has_enumeration = false;
    let n = schema.fields.length;
    for (i = 0; i < n; i++) {
        if (schema.fields[i].category === "enumeration") {
            has_enumeration = true;
            break;
        }
    }

    // -------------------------------------------------------------------------
    // - insert class constructor
    // -------------------------------------------------------------------------

    write("");
    write("/**");
    if (schema.documentation) {
        write(" * " + schema.documentation);
    }
    write(" * ");
    write(" * @class " + classname);
    write(" * @constructor");
    write(" * @extends " + baseclass);
    // dump parameters

    write(" * @param  options {Object}");
    let def = "";
    for (i = 0; i < n; i++) {
        field = schema.fields[i];
        fieldType = field.fieldType;
        const documentation = field.documentation ? field.documentation : "";
        def = "";
        if (field.defaultValue !== undefined) {
            if (_.isFunction(field.defaultValue)) {
                def = " = " + field.defaultValue();
            } else {
                def = " = " + field.defaultValue;
            }
        }
        const ft = makeFieldType(field);
        //xx write(" * @param  [options." + field.name + def + "] " + ft + " " + documentation);
    }

    write(" */");

    write("function " + classname + "(options)");
    write("{");
    // write("    const value;");
    write("    options = options || {};");
    write("    /* istanbul ignore next */");
    write("    if (schema_helpers.doDebug) { check_options_correctness_against_schema(this,schema,options); }");
    write("    const self = this;");
    write("    assert(this instanceof BaseUAObject); //  ' keyword \"new\" is required for constructor call')");
    write("    resolve_schema_field_types(schema);");
    write("");

    if (_.isFunction(schema.construct_hook)) {
        write("    //construction hook");
        write("    options = schema.construct_hook(options); ");
    }
    if (baseclass) {
        write("    " + baseclass + ".call(this,options);");
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Special case when options === null => fast constructor for deserialization
    // -----------------------------------------------------------------------------------------------------------------
    write("    if (options === null) { ");
    if (baseclass) {
        write("        " + baseclass + ".call(this,options);");
    }
    for (i = 0; i < n; i++) {
        field = schema.fields[i];
        fieldType = field.fieldType;

        member = field.name;
        __member = "__" + member;
        if (field.category === "enumeration") {
            //xx write_enumeration(f, schema, field, member, i);
        } else if (field.category === "complex") {
            write_complex_fast_construct(f, schema, field, member, i);
        } else {
            //xx write_basic(f, schema, field, member, i);
        }
    }

    write("        return ;");
    write("    }");
    // -----------------------------------------------------------------------------------------------------------------

    for (i = 0; i < n; i++) {
        field = schema.fields[i];

        fieldType = field.fieldType;

        member = field.name;
        __member = "__" + member;

        write("");
        write("    /**");
        let documentation = field.documentation ? field.documentation : "";
        write("      * ", documentation);
        write("      * @property ", field.name);
        // write("      * @type {", (field.isArray ? "Array[" : "") + field.fieldType + (field.isArray ? " ]" : "")+"}");
        write("      * @type " + makeFieldType(field));

        if (field.defaultValue !== undefined) {
            write("      * @default  ", field.defaultValue);
        }

        write("      */");

        if (field.category === "enumeration") {
            write_enumeration(f, schema, field, member, i);
        } else if (field.category === "complex") {
            write_complex(f, schema, field, member, i);
        } else {
            write_basic(f, schema, field, member, i);
        }
    }

    write("");
    write("   // Object.preventExtensions(self);");
    write("}");

    // -------------------------------------------------------------------------
    // - inheritance chain
    // -------------------------------------------------------------------------

    write("util.inherits(" + classname + "," + baseclass + ");");

    // -------------------------------------------------------------------------
    // - Enumeration
    // -------------------------------------------------------------------------
    if (has_enumeration) {
        write("");
        write("//## Define Enumeration setters");

        for (i = 0; i < n; i++) {
            field = schema.fields[i];
            member = field.name;
            if (field.category === "enumeration") {
                write_enumeration_setter(f, schema, field, member, i);
            }
        }
    }

    // -------------------------------------------------------------------------
    // - encodingDefaultBinary
    // -------------------------------------------------------------------------

    if (RUNTIME_GENERATED_ID === encodingBinaryNodeId) {
        write("schema.id = generate_new_id();");
        write(classname + ".prototype.encodingDefaultBinary = makeExpandedNodeId(schema.id);");
    } else {
        write(
            classname + ".prototype.encodingDefaultBinary = makeExpandedNodeId(" + encodingBinaryNodeId.value + ",",
            encodingBinaryNodeId.namespace,
            ");"
        );
    }

    if (encodingXmlNodeId) {
        write(
            classname + ".prototype.encodingDefaultXml = makeExpandedNodeId(" + encodingXmlNodeId.value + ",",
            encodingXmlNodeId.namespace,
            ");"
        );
    }
    write(classname + ".prototype._schema = schema;");

    //  --------------------------------------------------------------
    //   expose encoder and decoder func for basic type that we need
    //  --------------------------------------------------------------
    write("");
    n = schema.fields.length;
    const done = {};
    for (i = 0; i < n; i++) {
        field = schema.fields[i];
        fieldType = field.fieldType;
        if (!(fieldType in done)) {
            done[fieldType] = field;
            if (field.category === "enumeration") {
                write("const encode_" + field.fieldType + " = _enumerations." + field.fieldType + ".encode;");
                write("const decode_" + field.fieldType + " = _enumerations." + field.fieldType + ".decode;");
            } else if (field.category === "complex") {
                //
            } else {
                write("const encode_" + field.fieldType + " = _defaultTypeMap." + field.fieldType + ".encode;");
                write("const decode_" + field.fieldType + " = _defaultTypeMap." + field.fieldType + ".decode;");
            }
        }
    }

    //  --------------------------------------------------------------
    //   implement encode
    //  ---------------------------------------------------------------
    if (_.isFunction(schema.encode)) {
        write(classname + ".prototype.encode = function(stream,options) {");
        write("   schema.encode(this,stream,options); ");
        write("};");
    } else {
        write("/**");
        write(" * encode the object into a binary stream");
        write(" * @method encode");
        write(" *");
        write(" * @param stream {BinaryStream} ");
        write(" */");

        write(classname + ".prototype.encode = function(stream,options) {");
        write("    // call base class implementation first");
        write("    " + baseclass + ".prototype.encode.call(this,stream,options);");

        n = schema.fields.length;
        for (i = 0; i < n; i++) {
            field = schema.fields[i];
            fieldType = field.fieldType;
            member = field.name;

            if (field.category === "enumeration" || field.category === "basic") {
                if (field.isArray) {
                    write("    encodeArray(this." + member + ", stream, encode_" + field.fieldType + ");");
                } else {
                    write("    encode_" + field.fieldType + "(this." + member + ",stream);");
                }
            } else if (field.category === "complex") {
                if (field.isArray) {
                    write(
                        "    encodeArray(this." +
                            member +
                            ",stream,function(obj,stream){ obj.encode(stream,options); }); "
                    );
                } else {
                    write("   this." + member + ".encode(stream,options);");
                }
            }
        }
        write("};");
    }

    //  --------------------------------------------------------------
    //   implement decode
    //  ---------------------------------------------------------------
    if (_.isFunction(schema.decode)) {
        write("/**");
        write(" * decode the object from a binary stream");
        write(" * @method decode");
        write(" *");
        write(" * @param stream {BinaryStream} ");
        write(" */");

        write(classname + ".prototype.decode = function(stream) {");
        write("   schema.decode(this,stream); ");
        write("};");

        if (!_.isFunction(schema.decode_debug)) {
            throw new Error("schema decode requires also to provide a decode_debug " + schema.name);
        }
        write(classname + ".prototype.decode_debug = function(stream,options) {");
        write("   schema.decode_debug(this,stream,options); ");
        write("};");
    } else {
        write("/**");
        write(" * decode the object from a binary stream");
        write(" * @method decode");
        write(" *");
        write(" * @param stream {BinaryStream} ");
        write(" */");
        write(classname + ".prototype.decode = function(stream) {");
        write("    // call base class implementation first");
        write("    " + baseclass + ".prototype.decode.call(this,stream);");

        n = schema.fields.length;
        for (i = 0; i < n; i++) {
            field = schema.fields[i];
            fieldType = field.fieldType;
            member = field.name;
            if (field.category === "enumeration" || field.category === "basic") {
                if (field.isArray) {
                    write("    this." + member + " = decodeArray(stream, decode_" + field.fieldType + ");");
                } else {
                    if (is_complex_type) {
                        write("    this." + member + ".decode(stream);");
                    } else {
                        if (_.isFunction(field.decode)) {
                            write("    this." + member + " = schema.fields[" + i + "].decode(stream);");
                        } else {
                            write("    this." + member + " = decode_" + field.fieldType + "(stream);");
                        }
                    }
                }
            } else {
                assert(field.category === "complex");
                if (field.isArray) {
                    write("    this." + member + " = decodeArray(stream, function(stream) { ");
                    write("       const obj = new " + field.fieldType + "(null);");
                    write("       obj.decode(stream);");
                    write("       return obj; ");
                    write("    });");
                } else {
                    write("    this." + member + ".decode(stream);");
                    // xx write("    this." + member + ".decode(stream);");
                }
            }
        }
        write("};");
    }

    //  --------------------------------------------------------------
    //   implement explore
    //  ---------------------------------------------------------------
    //    write("/**");
    //    write(" *");
    //    write(" * pretty print the object");
    //    write(" * @method explore");
    //    write(" *");
    //    write(" */");
    //    write(classname + ".prototype.explore = function() {");
    //    write("};");

    // ---------------------------------------
    if (_.isFunction(schema.isValid)) {
        write("/**");
        write(" *");
        write(" * verify that all object attributes values are valid according to schema");
        write(" * @method isValid");
        write(" * @return {Boolean}");
        write(" */");
        write(classname + ".prototype.isValid = function() { return schema.isValid(this); };");
    }

    function quotify(str) {
        return '"' + str + '"';
    }

    const possible_fields = extract_all_fields(schema);

    write(classname + ".possibleFields = [");
    write("  " + possible_fields.map(quotify).join(",\n         "));
    write("];");
    write("\n");

    write("exports." + classname + " = " + classname + ";");
    write(
        'const register_class_definition = require("node-opcua-factory/src/factories_factories").register_class_definition;'
    );
    write('register_class_definition("' + classname + '",' + classname + ");");
    write("");

    f.save(source_file);
}

exports.produce_code = produce_code;
