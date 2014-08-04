// backbone.stickit.parser.js
// version 0.1.0
// copyright (c) 2014, Intuit Inc., craig_lasalle@intuit.com
(function (factory) {
    "use strict";

    // Set up appropriately for the environment. Start with AMD.
    if (typeof define === 'function' && define.amd) {
        define(['jquery', 'underscore', 'backbone', 'stickit', 'exports'], factory);
    }

    // Next for Node.js or CommonJS.
    else if (typeof exports === 'object') {
        factory(require('jquery'), require('underscore'), require('backbone'), require('stickit'), exports);
    }

    // As a browser global.
    else {
        factory($, _, Backbone, Backbone.Stickit);
    }

}(function ($, _, Backbone, Stickit) {
    "use strict";

    /*
     *
     * Here's an example of the binding specification:
     *
     *    * option 1: model name is part of attribution
     *    data-bind="value:employee#address.zip|+fooFormatter|-fooFilter,disabled:isFullTime,class:isImportant|+classSelector,events:blur+keyup"
     *
     *    * option 2: model name is set in a separate operand
     *    data-bind="model:employee,value:address.zip|+fooFormatter|-fooFilter,disabled:isFullTime,class:isImportant|+classSelector,events:blur+keyup"
     *
     *    * option 3:
     *    use both 1) and 2) so allow multiple models with fully qualified model attribute specifications
     *
     *    Notes:
     *    1) The '+' means a formatter, mapped to onGet / onSet. The '-' means a filter, mapped to updateView,
     *      updateModel.
     *    2) If + or - is on the left of the function name, the filter or formatter gets applied when updating the
     *      DOM. If it is on the right, then the filter or formatter gets applied when updating the model.
     *
     *    And here's how it breaks down in nomenclature:
     *
     *    value = operand
     *    employee = model
     *    address.zip = model attribute
     *    fooFormatter = formatter / filter
     *    fooFilter = formatter / filter
     *    disabled = operand
     *    class = operand
     *    events = operand
     *
     *    Depending on the type of operand, the data in the binding declaration will populate different aspects of the
     *    StickIt binding declaration.
     */

    var FILTER_CHAR = '-';
    var FORMATTER_CHAR = '+';
    var DEFAULT_BIND_OPTIONS = { bindAttribute: 'data-bind' };
    var STICKIT_ONGET = 'onGet';
    var STICKIT_ONSET = 'onSet';
    var STICKIT_UPDATE_VIEW = 'updateView';
    var STICKIT_UPDATE_MODEL = 'updateModel';

    // Parser namespace as part of Stickit
    // -----------------------------------
    Stickit.Parser = {};

    Stickit.Parser.ViewMixin = {

        /**
         * Stickit Parser API
         *
         * Main method to do data binding that includes parsing any binding declarations from
         * the DOM. Call this in place of the standard view.stickit() API.
         *
         * @param options
         * options = { optionalModel: myModel, optionalBindings: myBindings, optionalBindOptions: myBindOptions }
         *
         * optionalBindOptions = { bindAttribute: 'my-data-bind', modelName: 'myModelName' }
         *
         */
        stickitParse: function(options) {
            var bindOptions, bindAttribute, dataBindSelector, dataBindElements, bindings,
                bindDeclaration, stickItBinding, stickItBindings = {}, jQueryElement, model;

            bindOptions = _.clone(DEFAULT_BIND_OPTIONS); // caution: shallow copy

            if (options) {
                model = options.optionalModel || this.model;
                bindings = options.optionalBindings;
                bindOptions = _.extend(bindOptions, options.optionalBindOptions);
            } else {
                model = this.model;
            }

            // let stickit do its stuff first
            this.stickit(model, bindings);

            // describe the DOM nodes we care about
            bindAttribute = bindOptions.bindAttribute;
            dataBindSelector = "[" + bindAttribute + (bindOptions.modelName ? "*='model:" + bindOptions.modelName + "']" : "]");

            // collect the DOM nodes we described
            dataBindElements = this.$(dataBindSelector);

            // process the DOM nodes we collected
            _.each(dataBindElements, function(element) {
                jQueryElement = this.$(element);
                bindDeclaration = jQueryElement.attr(bindAttribute);
                stickItBinding = _processBindingDeclaration(bindDeclaration, jQueryElement);
                _.extend(stickItBindings, stickItBinding);
            }, this);

            //console.log("stickIt bindings: " + JSON.stringify(stickItBindings));

            // add any bindings we extracted from the DOM to the stickIt structure(s)
            this.addBinding(model, stickItBindings);
        }
    };

    _.extend(Backbone.View.prototype, Stickit.Parser.ViewMixin);

    //////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////
    //
    // Helpers
    //
    //////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////

    function BindingParseException(message, value) {
        this.message = message;
        this.value = value;
        this.toString = function() {
            return this.message + ": " + this.value;
        };
    }

    /**
     * Parse the model declaration out of the binding declaration, and add the settings to the
     * binding specification structure.
     *
     * @param bindingSpecification
     * @param bindingDeclaration
     * @returns {*}
     * @private
     */
    var _parseModelQualifierDeclaration = function(bindingSpecification, bindingDeclaration) {
        //console.log("invoking _parseModelQualifierDeclaration");
        var modelParamList = bindingDeclaration.split('#');
        if (modelParamList.length > 1) {
            // there exists a 'model' specification
            bindingSpecification['model'] = modelParamList[0];
            // shift the model declaration out of bindingDeclaration
            bindingDeclaration = modelParamList[1];
        } else {
            bindingDeclaration = modelParamList[0];
        }
        return bindingDeclaration;
    }

    /**
     * Parse the model attribute declaration out of the binding declaration.
     *
     * Note that the declaration may have filter and formatter specifications that
     * we need to preserve for the next declaration parsing step.
     *
     * Model attributes look like: revenue+isProfitable|+myFormatter
     * The model attributes are the "revenue+isProfitable" parts of the string
     * declaration.
     *
     * @param bindingSpecification
     * @param bindingDeclaration
     *
     */
    var _parseModelAttributeDeclaration = function(bindingSpecification, bindingDeclaration) {
        //console.log("invoking _parseModelAttributeDeclaration");
        var attributesList, attributeAndFilterList, filters;
        attributeAndFilterList = bindingDeclaration.split('|');
        if (attributeAndFilterList.length === 0) {
            throw new BindingParseException("at least one model attribute is required", bindingDeclaration);
        } else {
            attributesList = attributeAndFilterList[0].split('+');
            bindingSpecification['attributes'] = [];
            _.each(attributesList, function(element) {
                bindingSpecification['attributes'].push(element);
            });
            if (attributeAndFilterList.length === 1) {
                bindingDeclaration = undefined; // no more processing
            } else if (attributeAndFilterList.length > 1) {
                // need to glue filters back together for subsequent filter/formatter processing
                filters = _.rest(attributeAndFilterList, 1);
                bindingDeclaration = filters.join('|');
            }
        }
        return bindingDeclaration;
    }

    /**
     * Parse the binding declaration for filter information and build the intermediate
     * binding specification structure.
     *
     * @param bindingSpecification
     * @param bindingDeclaration
     * @returns {undefined}
     * @private
     */
    var _parseFilterDeclaration = function(bindingSpecification, bindingDeclaration) {
        //console.log("invoking _parseFilterDeclaration");
        if (_.isUndefined(bindingDeclaration)) { // filters are optional
            return undefined;
        }

        var _isValidFilterDeclaration = function(s) {
            var validRE = /[+\-][A-Za-z0-9_]+|[A-Za-z0-9_]+[+\-]/;
            var matched = s.match(validRE);
            return (matched !== null && matched.length === 1 && matched[0].length === s.length);
        }

        bindingSpecification['filters'] = [];
        var filterParamList = bindingDeclaration.split('|');
        var nameRE= /[A-Za-z0-9_]+/;

        _.each(filterParamList, function(element, index, list) {
            // build out the structure:
            // filterSpecification.name   ==> name of filter that will be a method on view class
            // filterSpecification.type   ==> type where '+' is formatter, '-' is filter
            // filterSpecification.target ==> direction, either 'dom' or 'model'
            var filterSpecification = {}, ffIndex;
            if (!_isValidFilterDeclaration(element)) {
                throw new BindingParseException("bad filter format", element);
            }
            filterSpecification.name = element.match(nameRE)[0];
            ffIndex = element.indexOf(FILTER_CHAR);
            if (ffIndex !== -1) {
                filterSpecification.type = FILTER_CHAR;
                filterSpecification.target = ffIndex === 0 ? 'dom' : 'model';
            } else {
                ffIndex = element.indexOf(FORMATTER_CHAR);
                filterSpecification.type = FORMATTER_CHAR;
                filterSpecification.target = ffIndex === 0 ? 'dom' : 'model';
            }
            //console.log("filter specification: " + JSON.stringify(filterSpecification));
            bindingSpecification.filters.push(filterSpecification);
        });

    }

    /**
     * Parse the data that follows the "events:" operand key in the binding
     * declaration string.
     *
     * That data has the form: blur+keyup
     *
     */
    var _parseEventsOperandDeclaration = function(bindingSpecification, bindingDeclaration) {
        //console.log("invoking _parseEventsOperandDeclaration: " + bindingDeclaration);
        var eventTypesList = bindingDeclaration.split('+');
        if (eventTypesList.length < 1) {
            throw new BindingParseException("no event types in events declaration", bindingDeclaration);
        }
        bindingSpecification.types = [];
        _.each(eventTypesList, function(element, index, list) {
            bindingSpecification.types.push(element);
        });
        return bindingDeclaration;
    }

    /**
     * Parse the data that follows the "model:" operand key in the binding
     * declaration string.
     *
     * The data has the form: myModelName1+myModelName2
     *
     */
    var _parseModelOperandDeclaration = function(bindingSpecification, bindingDeclaration) {
        var modelsList = bindingDeclaration.split('+');
        bindingSpecification.modelNames = [];
        _.each(modelsList, function(element) {
            bindingSpecification.modelNames.push(element);
        });
        return bindingDeclaration;
    }

    /**
     * Parse the data after any operand that is an actual data binding operand.
     * This includes the all powerful "value" operand that sets the DOM element value.
     * Or, it also includes any DOM element attributes / properties such as "class",
     * "disabled", etc.
     */
    var _parseDataBoundOperandDeclaration = function(bindingSpecification, bindingDeclaration) {
        // processing for operands that have a model<->attribute<->filter style of declaration
        bindingDeclaration = _parseModelQualifierDeclaration(bindingSpecification, bindingDeclaration);
        bindingDeclaration = _parseModelAttributeDeclaration(bindingSpecification, bindingDeclaration);
        _parseFilterDeclaration(bindingSpecification, bindingDeclaration);
    }

    /**
     * Parse one particular binding operand of the declaration string.
     * This includes the operand and the information following the operand.
     *
     */
    var _parseBindingOperand = function(bindingSpecification, bindingDeclaration) {
        var operandParamList, operand;
        // binding element looks like: "value:employee#address.zip|+format|-foo"
        // in general: "operand:[model#]attribute+attribute|[[-+]filter[-+]]"
        operandParamList = bindingDeclaration.split(':');

        // must be 2 in operandList ==> operand:bindingParameters
        if (operandParamList.length !== 2) {
            throw new BindingParseException("binding element formatting error", bindingDeclaration);
        }

        operand = operandParamList[0];

        bindingDeclaration = operandParamList[1];

        bindingSpecification[operand] = {};

        switch(operand) {
            case 'events':
                // events operand processing
                _parseEventsOperandDeclaration(bindingSpecification[operand], bindingDeclaration);
                break;
            case 'model':
                // model operand processing
                _parseModelOperandDeclaration(bindingSpecification[operand], bindingDeclaration);
            default:
                // data bound operand processing - all operands that are actual data bindings
                _parseDataBoundOperandDeclaration(bindingSpecification[operand], bindingDeclaration);
                break;
        }

    }

    /**
     * Parse the binding declaration string, and turn it into a bindingSpecification
     * structure. The bindingSpecification structure is a canonical format to more
     * easily convert into the StickIt bindings structure(s). Good old separation
     * of concerns, the most important architectural concept.
     *
     * The binding declaration is the string representation of the data-bind
     * information.
     *
     * The binding specification, in general, looks like:
     *
     * {
     *  value: {
     *      model: 'myModelName',           <== optional
     *      attributes: [ 'myModelAttr1', 'myModelAttr2'],
     *      filters: [
     *          {
     *          name: 'myFunc1',
     *          type: '+',
     *          target: 'dom'
     *          },
     *          {
     *          name: 'myFunc2',
     *          type: '-',
     *          target: 'model'
     *          }],
     *  }
     *   class: {
     *       attributes: ['myModelAttr3'],
     *       filters: [
     *          {
     *          name: 'myFunc2',
     *          type: '+',
     *          target: 'dom'
     *          }]
     *  }
     *   events: {
     *        types: ['blur','keyup']
     *  }
     *
     * It is an hash map where the outer keys are the 'operands'. The operands are top level settings like "value",
     * 'class', 'model', etc. The "values" are the data that are needed to configure stickit to do the binding.
     *
     * Here's what some operands do:
     *  value = bind the value of the DOM element to the model attribute. This is the main binder. You can apply
     *      filters and formatters as needed to translate between the model attribute and the DOM value.
     *  class = bind the class attribute of DOM element to the model attribute. Usually runs through a formatter
     *      method to translate the model attribute state into an actual class string.
     *  disabled = bind the model attribute to the 'disabled' DOM attribute. Look at the StickIt documentation
     *      for details on setting DOM attributes.
     *  model = used to filter the selected DOM elements for a particular model.
     *      Used with the bindOptions input.
     *  events = used to change the DOM events that trigger the binding. Refer to the StickIt documentation
     *      to see all the events and the default ones.
     *
     * Legend:
     *  '+' ==> means to apply a formatter that gets mapped to onSet or onGet. The 'name' is then the method name, and
     *      needs to support the onSet() or onGet() StickIt API. In the binding declaration, if the '+' is to
     *      the left of the function name, then apply the function when updating the DOM. If to the right of
     *      the function name, apply when updating the model.
     *  '-' ==> means to apply a filter that gets mapped to updateModel or updateView. The 'name' is then the method
     *      name and needs to support the updateView() or updateModel() StickIt API. The same rules apply as the
     *      '+' for direction of updating DOM or model.
     *  'dom' ==> apply the function when updating the DOM.
     *      Method will get mapped to onSet() or updateView().
     *  'model' ==> apply the function when updating the model.
     *      Method will get mapped to onGet() or updateModel().
     *
     *  Here's a real live working sample from a test page:
     *
     *   {
     *     "value": {
     *       "attributes": [
     *         "companyName"
     *       ],
     *       "filters": [
     *         {
     *           "name": "formatName",
     *           "type": "+",
     *           "target": "dom"
     *         }
     *       ]
     *     },
     *     "class": {
     *       "attributes": [
     *         "isProfitable"
     *       ],
     *       "filters": [
     *         {
     *           "name": "chooseClass",
     *           "type": "+",
     *           "target": "dom"
     *         }
     *       ]
     *     }
     *   }
     *
     */
    var _parseBindingDeclaration = function(bindingDeclaration) {
        var bindingSpecification = {};
        var topRE = /\s*,\s*/; // split on comma and remove spaces to get list of operands
        var bindingOperandsList = bindingDeclaration.split(topRE);

        _.each(bindingOperandsList, function(element) {
            _parseBindingOperand(bindingSpecification, element);
        });
        return bindingSpecification;
    }

    /**
     * Utility Method
     *
     * Select the right StickIt specific callback method to either do a formatter
     * or filter operation.
     *
     * + ==> formatter operation
     * - ==> filter operation
     *
     * See the StickIt documentation on updateModel and updateView callbacks.
     *
     */
    var _pickStickItCallback = function(type, target) {
        var callback;
        if (type === '+' && target === 'dom') {
            callback = STICKIT_ONGET;
        } else if (type === '+' && target === 'model') {
            callback = STICKIT_ONSET;
        } else if (type === '-' && target === 'dom') {
            callback = STICKIT_UPDATE_VIEW;
        } else if (type === '-' && target === 'model') {
            callback = STICKIT_UPDATE_MODEL;
        }
        return callback;
    }

    /**
     * Utility Method
     *
     * StickIt has structures where a single value, or an array gets set depending on whether
     * there is one element or an array of elements. Since we use arrays, this is a little helper
     * to return the correct single value or array.
     *
     */
    var _assignOneOrArray = function(array) {
        if (array.length === 0) {
            return undefined;
        } else if (array.length === 1) {
            return array[0];
        } else {
            return _.rest(array, 0);
        }
    }

    /**
     * Process the binding specification structure and generate the StickIt structure
     * for the one DOM element.
     *
     * Side effects:
     * (1) StickIt is jQuery selector based, so if we don't have an element id
     * then we generate one.
     *
     *
     * @param bindingSpecification
     * @private
     */
    var _processBindingSpecification = function(bindingSpecification, jQueryElement) {
        var elId, bindingSelector, callback, attr;
        var stickItBinding = {};

        if (!_.isUndefined(jQueryElement)) {
            elId = jQueryElement.attr("id");
            if (_.isUndefined(elId)) {
                //throw "element id is undefined";
                elId = _.uniqueId('stickit_'); // namespace it
                jQueryElement.attr("id", elId);
            }
        }

        bindingSelector = '#' + elId;

        // debug
        //console.log("elId = " + JSON.stringify(elId));

        // add the selector for the element
        stickItBinding[bindingSelector] = {};

        /*
         * Basic Algorithm: Loop over our canonical binding specification structure
         * and build the StickIt binding structure. The output structure from this
         * loop is StickIt specific, the StickIt bindings structure.
         *
         * Look at the backbone.stickit documentation to understand what is and is not
         * supported and how the bindings information should be structured.
         *
         */

        _.each(bindingSpecification, function(value, key, list) {
            // handle each operand that was parsed out into the binding specification
            //console.log("value: " + JSON.stringify(value) + " key: " + JSON.stringify(key));
            switch(key) {
                case 'value':
                    // 'value' sets the main model observe property
                    stickItBinding[bindingSelector].observe = _assignOneOrArray(value.attributes);
                    // loop over filters and add to stickit binding
                    if (!_.isUndefined(value.filters)) {
                        _.each(value.filters, function(element) {
                            callback = _pickStickItCallback(element.type, element.target)
                            stickItBinding[bindingSelector][callback] = element.name;
                        });
                    }
                    break;
                case 'disabled':
                case 'class':
                case 'readonly':
                    // set the appropriate DOM element attribute bindings
                    if (_.isUndefined(stickItBinding[bindingSelector].attributes)) {
                        stickItBinding[bindingSelector].attributes = [];
                    }
                    attr = {};
                    attr.name = key;
                    // todo: can we observe multiple model attributes here?
                    attr.observe = _assignOneOrArray(value.attributes);
                    if (!_.isUndefined(value.filters)) {
                        if (value.filters.length > 0) { // attributes only handle a single filter / formatter
                            callback = _pickStickItCallback(value.filters[0].type, value.filters[0].target);
                            attr[callback] = value.filters[0].name;
                        }
                    }
                    stickItBinding[bindingSelector].attributes.push(attr);
                    break;
                case 'events':
                    // set events on the main data binding
                    stickItBinding[bindingSelector].events = _.rest(value.types, 0);
                    break;
                default:
                    break;
            }
        });
        return stickItBinding;
    }

    /**
     * Process the binding declaration and generate a StickIt structure.
     *
     * @param bindingDeclaration
     * @private
     */
    var _processBindingDeclaration = function(bindingDeclaration, jQueryElement) {
        // parse the binding declaration
        var bindingSpecification, stickItBinding;
        bindingSpecification = _parseBindingDeclaration(bindingDeclaration);
        //console.log("Binding Specification: " + JSON.stringify(bindingSpecification));
        stickItBinding = _processBindingSpecification(bindingSpecification, jQueryElement);
        return stickItBinding;
    }

    // module return
    return Stickit.Parser;

}));
